import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { CLAUDE_MODELS, CURSOR_MODELS, CODEX_MODELS } from '../../shared/modelConstants.js';
import { parseFrontmatter } from '../utils/frontmatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Scan a directory of skills (each child directory contains a SKILL.md).
 * Symlinks to directories are followed (codex/claude skills are typically
 * symlinked from a central ~/.ai/skills location).
 * @param {string} dir - Directory containing skill folders (e.g. ~/.claude/skills)
 * @param {string} agent - 'claude' | 'codex'
 * @param {string} scope - 'user' | 'project' | 'plugin' | 'system'
 * @returns {Promise<Array>} Skill entries shaped like commands.
 */
async function scanSkillsDirectory(dir, agent, scope) {
  const skills = [];
  try {
    await fs.access(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden entries except for .system (codex internal skills)
      if (entry.name.startsWith('.') && entry.name !== '.system') continue;

      // 디렉토리 또는 디렉토리 심볼릭 링크 모두 허용
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          isDir = stat.isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;

      const skillDir = path.join(dir, entry.name);

      // .system 디렉토리는 한 단계 더 들어감 (codex skill-creator/skill-installer)
      if (entry.name === '.system') {
        const subSkills = await scanSkillsDirectory(skillDir, agent, 'system');
        skills.push(...subSkills);
        continue;
      }

      const skillMdPath = path.join(skillDir, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf8');
        const { data: frontmatter } = parseFrontmatter(content);
        const name = frontmatter.name || entry.name;
        let description = (frontmatter.description || '').toString().trim();
        // YAML folded scalar marker가 그대로 남은 경우 제거
        if (description === '>-' || description === '>') description = '';
        // 줄바꿈 정리 → 한 줄로 압축
        description = description.replace(/\s+/g, ' ').trim();
        skills.push({
          name: '/' + name,
          path: skillMdPath,
          relativePath: entry.name,
          description: description.slice(0, 200),
          namespace: `skill:${agent}`,
          agent,
          scope,
          kind: 'skill',
          metadata: { ...frontmatter, type: 'skill', agent, scope },
        });
      } catch {
        // SKILL.md missing — skip silently
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning skills directory ${dir}:`, err.message);
    }
  }
  return skills;
}

/**
 * Recursively find plugin-bundled skills.
 * Pattern: pluginRoot / (any depth) / skills / skillName / SKILL.md
 */
async function scanPluginSkills(pluginRoot, agent) {
  const results = [];
  async function walk(dir, depth) {
    if (depth > 6) return; // safety
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
      // 디렉토리 또는 디렉토리 심볼릭 링크
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          isDir = stat.isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      const sub = path.join(dir, entry.name);
      if (entry.name === 'skills') {
        // 그 아래의 모든 skill 디렉토리 스캔
        const skillEntries = await scanSkillsDirectory(sub, agent, 'plugin');
        results.push(...skillEntries);
      } else {
        await walk(sub, depth + 1);
      }
    }
  }
  await walk(pluginRoot, 0);
  return results;
}

/**
 * Recursively scan directory for command files (.md)
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string} namespace - Namespace for commands (e.g., 'project', 'user')
 * @returns {Promise<Array>} Array of command objects
 */
async function scanCommandsDirectory(dir, baseDir, namespace) {
  const commands = [];

  try {
    // Check if directory exists
    await fs.access(dir);

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, baseDir, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file for metadata
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const { data: frontmatter, content: commandContent } = parseFrontmatter(content);

          // Calculate relative path from baseDir for command name
          const relativePath = path.relative(baseDir, fullPath);
          // Remove .md extension and convert to command name
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from frontmatter or first line of content
          let description = frontmatter.description || '';
          if (!description) {
            const firstLine = commandContent.trim().split('\n')[0];
            description = firstLine.replace(/^#+\s*/, '').trim();
          }

          commands.push({
            name: commandName,
            path: fullPath,
            relativePath,
            description,
            namespace,
            metadata: frontmatter
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err.message);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed - this is okay
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      console.error(`Error scanning directory ${dir}:`, err.message);
    }
  }

  return commands;
}

/**
 * Built-in commands that are always available
 */
const builtInCommands = [
  {
    name: '/help',
    description: 'Show help documentation for Claude Code',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/clear',
    description: 'Clear the conversation history',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/model',
    description: 'Switch or view the current AI model',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/cost',
    description: 'Display token usage and cost information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/memory',
    description: 'Open CLAUDE.md memory file for editing',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/config',
    description: 'Open settings and configuration',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/status',
    description: 'Show system status and version information',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  },
  {
    name: '/rewind',
    description: 'Rewind the conversation to a previous state',
    namespace: 'builtin',
    metadata: { type: 'builtin' }
  }
];

/**
 * Built-in command handlers
 * Each handler returns { type: 'builtin', action: string, data: any }
 */
const builtInHandlers = {
  '/help': async (args, context) => {
    const helpText = `# Claude Code Commands

## Built-in Commands

${builtInCommands.map(cmd => `### ${cmd.name}
${cmd.description}
`).join('\n')}

## Custom Commands

Custom commands can be created in:
- Project: \`.claude/commands/\` (project-specific)
- User: \`~/.claude/commands/\` (available in all projects)

### Command Syntax

- **Arguments**: Use \`$ARGUMENTS\` for all args or \`$1\`, \`$2\`, etc. for positional
- **File Includes**: Use \`@filename\` to include file contents
- **Bash Commands**: Use \`!command\` to execute bash commands

### Examples

\`\`\`markdown
/mycommand arg1 arg2
\`\`\`
`;

    return {
      type: 'builtin',
      action: 'help',
      data: {
        content: helpText,
        format: 'markdown'
      }
    };
  },

  '/clear': async (args, context) => {
    return {
      type: 'builtin',
      action: 'clear',
      data: {
        message: 'Conversation history cleared'
      }
    };
  },

  '/model': async (args, context) => {
    // Read available models from centralized constants
    const availableModels = {
      claude: CLAUDE_MODELS.OPTIONS.map(o => o.value),
      cursor: CURSOR_MODELS.OPTIONS.map(o => o.value),
      codex: CODEX_MODELS.OPTIONS.map(o => o.value)
    };

    const currentProvider = context?.provider || 'claude';
    const currentModel = context?.model || CLAUDE_MODELS.DEFAULT;

    return {
      type: 'builtin',
      action: 'model',
      data: {
        current: {
          provider: currentProvider,
          model: currentModel
        },
        available: availableModels,
        message: args.length > 0
          ? `Switching to model: ${args[0]}`
          : `Current model: ${currentModel}`
      }
    };
  },

  '/cost': async (args, context) => {
    const tokenUsage = context?.tokenUsage || {};
    const provider = context?.provider || 'claude';
    const model =
      context?.model ||
      (provider === 'cursor'
        ? CURSOR_MODELS.DEFAULT
        : provider === 'codex'
          ? CODEX_MODELS.DEFAULT
          : CLAUDE_MODELS.DEFAULT);

    const used = Number(tokenUsage.used ?? tokenUsage.totalUsed ?? tokenUsage.total_tokens ?? 0) || 0;
    const total =
      Number(
        tokenUsage.total ??
          tokenUsage.contextWindow ??
          parseInt(process.env.CONTEXT_WINDOW || '160000', 10),
      ) || 160000;
    const percentage = total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0;

    const inputTokensRaw =
      Number(
        tokenUsage.inputTokens ??
          tokenUsage.input ??
          tokenUsage.cumulativeInputTokens ??
          tokenUsage.promptTokens ??
          0,
      ) || 0;
    const outputTokens =
      Number(
        tokenUsage.outputTokens ??
          tokenUsage.output ??
          tokenUsage.cumulativeOutputTokens ??
          tokenUsage.completionTokens ??
          0,
      ) || 0;
    const cacheTokens =
      Number(
        tokenUsage.cacheReadTokens ??
          tokenUsage.cacheCreationTokens ??
          tokenUsage.cacheTokens ??
          tokenUsage.cachedTokens ??
          0,
      ) || 0;

    // If we only have total used tokens, treat them as input for display/estimation.
    const inputTokens =
      inputTokensRaw > 0 || outputTokens > 0 || cacheTokens > 0 ? inputTokensRaw + cacheTokens : used;

    // Rough default rates by provider (USD / 1M tokens).
    const pricingByProvider = {
      claude: { input: 3, output: 15 },
      cursor: { input: 3, output: 15 },
      codex: { input: 1.5, output: 6 },
    };
    const rates = pricingByProvider[provider] || pricingByProvider.claude;

    const inputCost = (inputTokens / 1_000_000) * rates.input;
    const outputCost = (outputTokens / 1_000_000) * rates.output;
    const totalCost = inputCost + outputCost;

    return {
      type: 'builtin',
      action: 'cost',
      data: {
        tokenUsage: {
          used,
          total,
          percentage,
        },
        cost: {
          input: inputCost.toFixed(4),
          output: outputCost.toFixed(4),
          total: totalCost.toFixed(4),
        },
        model,
      },
    };
  },

  '/status': async (args, context) => {
    // Read version from package.json
    const packageJsonPath = path.join(path.dirname(__dirname), '..', 'package.json');
    let version = 'unknown';
    let packageName = 'claude-code-ui';

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      version = packageJson.version;
      packageName = packageJson.name;
    } catch (err) {
      console.error('Error reading package.json:', err);
    }

    const uptime = process.uptime();
    const uptimeMinutes = Math.floor(uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeFormatted = uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;

    return {
      type: 'builtin',
      action: 'status',
      data: {
        version,
        packageName,
        uptime: uptimeFormatted,
        uptimeSeconds: Math.floor(uptime),
        model: context?.model || 'claude-sonnet-4.5',
        provider: context?.provider || 'claude',
        nodeVersion: process.version,
        platform: process.platform
      }
    };
  },

  '/memory': async (args, context) => {
    const projectPath = context?.projectPath;

    if (!projectPath) {
      return {
        type: 'builtin',
        action: 'memory',
        data: {
          error: 'No project selected',
          message: 'Please select a project to access its CLAUDE.md file'
        }
      };
    }

    const claudeMdPath = path.join(projectPath, 'CLAUDE.md');

    // Check if CLAUDE.md exists
    let exists = false;
    try {
      await fs.access(claudeMdPath);
      exists = true;
    } catch (err) {
      // File doesn't exist
    }

    return {
      type: 'builtin',
      action: 'memory',
      data: {
        path: claudeMdPath,
        exists,
        message: exists
          ? `Opening CLAUDE.md at ${claudeMdPath}`
          : `CLAUDE.md not found at ${claudeMdPath}. Create it to store project-specific instructions.`
      }
    };
  },

  '/config': async (args, context) => {
    return {
      type: 'builtin',
      action: 'config',
      data: {
        message: 'Opening settings...'
      }
    };
  },

  '/rewind': async (args, context) => {
    const steps = args[0] ? parseInt(args[0]) : 1;

    if (isNaN(steps) || steps < 1) {
      return {
        type: 'builtin',
        action: 'rewind',
        data: {
          error: 'Invalid steps parameter',
          message: 'Usage: /rewind [number] - Rewind conversation by N steps (default: 1)'
        }
      };
    }

    return {
      type: 'builtin',
      action: 'rewind',
      data: {
        steps,
        message: `Rewinding conversation by ${steps} step${steps > 1 ? 's' : ''}...`
      }
    };
  }
};

/**
 * POST /api/commands/list
 * List all available commands from project and user directories
 */
router.post('/list', async (req, res) => {
  try {
    const { projectPath } = req.body;
    const homeDir = os.homedir();
    const allCommands = [...builtInCommands];

    // Scan project-level commands (.claude/commands/)
    if (projectPath) {
      const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
      const projectCommands = await scanCommandsDirectory(
        projectCommandsDir,
        projectCommandsDir,
        'project'
      );
      allCommands.push(...projectCommands);
    }

    // Scan user-level commands (~/.claude/commands/)
    const userCommandsDir = path.join(homeDir, '.claude', 'commands');
    const userCommands = await scanCommandsDirectory(
      userCommandsDir,
      userCommandsDir,
      'user'
    );
    allCommands.push(...userCommands);

    // ────────────────────────────────────────────────────────────
    // Skills 스캔 (Claude + Codex, user/project/plugin/system 범위)
    // ────────────────────────────────────────────────────────────
    const skillSources = [
      // Claude
      { dir: path.join(homeDir, '.claude', 'skills'), agent: 'claude', scope: 'user' },
      // Codex
      { dir: path.join(homeDir, '.codex', 'skills'), agent: 'codex', scope: 'user' },
    ];

    if (projectPath) {
      skillSources.push({
        dir: path.join(projectPath, '.claude', 'skills'),
        agent: 'claude',
        scope: 'project',
      });
    }

    const skillResults = await Promise.all(
      skillSources.map(({ dir, agent, scope }) => scanSkillsDirectory(dir, agent, scope)),
    );
    const allSkills = skillResults.flat();

    // Plugin-bundled skills (recursive)
    const pluginRoots = [
      { dir: path.join(homeDir, '.claude', 'plugins'), agent: 'claude' },
      { dir: path.join(homeDir, '.codex', 'plugins'), agent: 'codex' },
    ];
    const pluginResults = await Promise.all(
      pluginRoots.map(({ dir, agent }) => scanPluginSkills(dir, agent)),
    );
    allSkills.push(...pluginResults.flat());

    // 중복 제거 (이름 + agent 기준): plugin 우선, 다음 user, project
    const seen = new Map();
    const skillPriority = { project: 3, user: 2, plugin: 1, system: 0 };
    for (const skill of allSkills) {
      const key = `${skill.agent}:${skill.name}`;
      const existing = seen.get(key);
      if (!existing || (skillPriority[skill.scope] ?? -1) > (skillPriority[existing.scope] ?? -1)) {
        seen.set(key, skill);
      }
    }
    const dedupedSkills = Array.from(seen.values());
    dedupedSkills.sort((a, b) => a.name.localeCompare(b.name));

    // Separate built-in and custom commands
    const customCommands = allCommands.filter(cmd => cmd.namespace !== 'builtin');

    // Sort commands alphabetically by name
    customCommands.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      builtIn: builtInCommands,
      custom: customCommands,
      skills: dedupedSkills,
      count: allCommands.length + dedupedSkills.length,
    });
  } catch (error) {
    console.error('Error listing commands:', error);
    res.status(500).json({
      error: 'Failed to list commands',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/load
 * Load a specific command file and return its content and metadata
 */
router.post('/load', async (req, res) => {
  try {
    const { commandPath } = req.body;

    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required'
      });
    }

    // Security: Prevent path traversal
    const resolvedPath = path.resolve(commandPath);
    if (!resolvedPath.startsWith(path.resolve(os.homedir())) &&
        !resolvedPath.includes('.claude/commands')) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Command must be in .claude/commands directory'
      });
    }

    // Read and parse the command file
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = parseFrontmatter(content);

    res.json({
      path: commandPath,
      metadata,
      content: commandContent
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error loading command:', error);
    res.status(500).json({
      error: 'Failed to load command',
      message: error.message
    });
  }
});

/**
 * POST /api/commands/execute
 * Execute a command with argument replacement
 * This endpoint prepares the command content but doesn't execute bash commands yet
 * (that will be handled in the command parser utility)
 */
router.post('/execute', async (req, res) => {
  try {
    const { commandName, commandPath, args = [], context = {} } = req.body;

    if (!commandName) {
      return res.status(400).json({
        error: 'Command name is required'
      });
    }

    // Handle built-in commands
    const handler = builtInHandlers[commandName];
    if (handler) {
      try {
        const result = await handler(args, context);
        return res.json({
          ...result,
          command: commandName
        });
      } catch (error) {
        console.error(`Error executing built-in command ${commandName}:`, error);
        return res.status(500).json({
          error: 'Command execution failed',
          message: error.message,
          command: commandName
        });
      }
    }

    // Handle custom commands
    if (!commandPath) {
      return res.status(400).json({
        error: 'Command path is required for custom commands'
      });
    }

    // Load command content
    // Security: validate commandPath is within allowed directories
    {
      const resolvedPath = path.resolve(commandPath);
      const userBase = path.resolve(path.join(os.homedir(), '.claude', 'commands'));
      const projectBase = context?.projectPath
        ? path.resolve(path.join(context.projectPath, '.claude', 'commands'))
        : null;
      const isUnder = (base) => {
        const rel = path.relative(base, resolvedPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };
      if (!(isUnder(userBase) || (projectBase && isUnder(projectBase)))) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Command must be in .claude/commands directory'
        });
      }
    }
    const content = await fs.readFile(commandPath, 'utf8');
    const { data: metadata, content: commandContent } = parseFrontmatter(content);
    // Basic argument replacement (will be enhanced in command parser utility)
    let processedContent = commandContent;

    // Replace $ARGUMENTS with all arguments joined
    const argsString = args.join(' ');
    processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

    // Replace $1, $2, etc. with positional arguments
    args.forEach((arg, index) => {
      const placeholder = `$${index + 1}`;
      processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
    });

    res.json({
      type: 'custom',
      command: commandName,
      content: processedContent,
      metadata,
      hasFileIncludes: processedContent.includes('@'),
      hasBashCommands: processedContent.includes('!')
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        error: 'Command not found',
        message: `Command file not found: ${req.body.commandPath}`
      });
    }

    console.error('Error executing command:', error);
    res.status(500).json({
      error: 'Failed to execute command',
      message: error.message
    });
  }
});

export default router;
