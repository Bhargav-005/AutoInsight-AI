import { useState, type FormEvent } from 'react'
import { FlaskConical } from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  Empty,
  FutureButton,
  Notice,
  PageHeader,
  Panel,
  TabPanel,
  Tabs,
} from '../components/ui'

export default function Models() {
  const { fixture } = usePreview()
  const [task, setTask] = useState('regression')
  const [target, setTarget] = useState('revenue')
  const [tab, setTab] = useState('comparison')
  const [prediction, setPrediction] = useState('')
  const [error, setError] = useState(false)
  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = new FormData(event.currentTarget).get('units')
    const invalid =
      input === '' || !Number.isFinite(Number(input)) || Number(input) < 0
    setError(invalid)
    setPrediction(
      invalid
        ? 'Enter a non-negative number of units.'
        : 'Input validated locally. No trained model is connected, so no prediction was generated.',
    )
  }
  return (
    <>
      <PageHeader
        eyebrow="EXPERIMENT WITH DISCIPLINE"
        title="ML Studio"
        description="Define the question before you train the model."
        actions={<FutureButton phase={6}>Create experiment</FutureButton>}
      />
      <Notice dismissible>
        Configuration preview only. No experiment is saved, no model is trained
        and no evaluation scores are available.
      </Notice>
      <div className="ml-layout">
        <Panel
          title="Experiment setup"
          subtitle="An intentional starting point"
        >
          <label>
            Dataset
            <select disabled={!fixture}>
              <option>
                {fixture
                  ? 'Retail operations · Sample v1'
                  : 'No connected dataset'}
              </option>
            </select>
          </label>
          <fieldset className="segmented">
            <legend>Prediction task</legend>
            {['regression', 'classification'].map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="task"
                  checked={task === value}
                  onChange={() => {
                    setTask(value)
                    setTarget(value === 'regression' ? 'revenue' : 'category')
                  }}
                />
                <span>
                  {value === 'regression' ? 'Regression' : 'Classification'}
                </span>
              </label>
            ))}
          </fieldset>
          <label>
            Target column
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!fixture}
            >
              {(task === 'regression'
                ? ['revenue', 'units']
                : ['category', 'region']
              ).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Candidate model
            <select key={task}>
              <option>
                {task === 'regression'
                  ? 'Linear regression'
                  : 'Logistic regression'}
              </option>
              <option>Random forest</option>
            </select>
          </label>
          <label>
            Held-out test split
            <select defaultValue="20">
              <option value="20">20% test / 80% training</option>
              <option value="25">25% test / 75% training</option>
              <option value="30">30% test / 70% training</option>
            </select>
          </label>
          <label>
            Random seed
            <input type="number" defaultValue={42} min={0} max={2147483647} />
          </label>
          <div className="warning-note">
            Preview configuration stays in memory. The future backend will
            validate task suitability, sample size and leakage risks.
          </div>
        </Panel>
        <div className="ml-results">
          <Panel
            title="Experiment progression"
            subtitle="The intended sequence · Not started"
          >
            <ol className="experiment-steps">
              {['Validate', 'Split', 'Train', 'Evaluate'].map((step, i) => (
                <li key={step}>
                  <span>0{i + 1}</span>
                  <strong>{step}</strong>
                  <small>Not started</small>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel
            title="Evaluation workspace"
            subtitle="Actual measurements will appear after training"
            action={<Badge>No experiments</Badge>}
          >
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'comparison', label: 'Model comparison' },
                { id: 'evaluation', label: 'Evaluation' },
                { id: 'importance', label: 'Feature importance' },
              ]}
            />
            <TabPanel id={tab}>
              <Empty
                title={
                  tab === 'comparison'
                    ? 'A fair comparison starts with a baseline.'
                    : tab === 'evaluation'
                      ? task === 'regression'
                        ? 'Residuals need real predictions.'
                        : 'A confusion matrix needs real predictions.'
                      : 'Understand influence, with context.'
                }
              >
                {tab === 'comparison'
                  ? 'Candidate models and dummy baselines will share a defined split. No accuracy, F1 or error metrics have been produced.'
                  : tab === 'evaluation'
                    ? 'Held-out results and appropriate metrics will be shown here in Phase 6.'
                    : 'Feature importance will be tied to a trained model and its methodology, with limitations made explicit.'}
              </Empty>
            </TabPanel>
          </Panel>
        </div>
      </div>
      <div className="two-column">
        <Panel
          title="Prediction preview"
          subtitle="Validate an input without pretending to predict"
        >
          <form onSubmit={validate} noValidate>
            <label>
              Units
              <input
                type="number"
                name="units"
                placeholder="e.g. 12"
                aria-invalid={error}
                aria-describedby="prediction-message"
              />
            </label>
            <button className="button secondary" type="submit">
              Validate input locally
            </button>
            <p
              id="prediction-message"
              role={error ? 'alert' : 'status'}
              className={error ? 'field-error' : 'inline-status'}
            >
              {prediction ||
                'No model is connected. This form does not submit data.'}
            </p>
          </form>
        </Panel>
        <Panel
          title="Methodology before metrics"
          subtitle="The principles behind a trustworthy experiment"
        >
          <div className="methodology">
            <FlaskConical size={26} />
            <p>
              Split data before fitting preprocessing. Compare against a dummy
              baseline. Report held-out metrics, not training scores.
            </p>
          </div>
          <details>
            <summary>Leakage & sample-size warnings</summary>
            <p>
              The twelve-row development sample is an interface fixture, not a
              suitable training dataset. Target leakage, fitted transforms and
              class balance require backend validation before training.
            </p>
          </details>
        </Panel>
      </div>
    </>
  )
}
