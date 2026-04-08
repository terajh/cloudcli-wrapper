import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WizardStep } from '../types';

type WizardProgressProps = {
  step: WizardStep;
};

export default function WizardProgress({ step }: WizardProgressProps) {
  const { t } = useTranslation();
  const steps: WizardStep[] = [1, 2, 3];

  return (
    <div className="px-6 pb-2 pt-4">
      <div className="flex items-center justify-between">
        {steps.map((currentStep) => (
          <Fragment key={currentStep}>
            <div className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  currentStep < step
                    ? 'bg-primary/20 text-primary'
                    : currentStep === step
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {currentStep < step ? <Check className="h-3.5 w-3.5" /> : currentStep}
              </div>
              <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
                {currentStep === 1
                  ? t('projectWizard.steps.type')
                  : currentStep === 2
                    ? t('projectWizard.steps.configure')
                    : t('projectWizard.steps.confirm')}
              </span>
            </div>

            {currentStep < 3 && (
              <div
                className={`mx-2 h-px flex-1 rounded ${
                  currentStep < step ? 'bg-primary/40' : 'bg-border'
                }`}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
