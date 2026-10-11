import { useState } from 'react'
import { useParams } from 'react-router'
import { ArrowRight, Check, Copy, Droplets, ScanLine, X } from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  Empty,
  FutureButton,
  Notice,
  PageHeader,
  Panel,
  Stat,
} from '../components/ui'

export default function Cleaning() {
  const { fixture } = usePreview()
  const { id } = useParams()
  const sample = fixture && id === fixture.dataset.id
  const [selection, setSelection] = useState('label')
  const [review, setReview] = useState('')
  return (
    <>
      <PageHeader
        eyebrow="PREPARE WITH INTENT"
        title="Cleaning Studio"
        description="Review the issues. Understand the change. Keep the original."
        actions={<FutureButton phase={5}>Apply approved plan</FutureButton>}
      />
      <Notice>
        Suggestions are previews, never applied transformations.{' '}
        {sample
          ? 'The example illustrates two missing region labels in the synthetic sample.'
          : 'Select the development sample to inspect an illustrative cleaning plan.'}
      </Notice>
      <div className="stats-grid three">
        <Stat
          label="Missing values"
          value={sample ? '02' : '—'}
          detail={
            sample
              ? '2 of 72 cells in this fixture'
              : 'Profile service not connected'
          }
          icon={<Droplets size={18} />}
        />
        <Stat
          label="Duplicate records"
          value={sample ? '00' : '—'}
          detail={
            sample ? 'No exact duplicates in sample' : 'No dataset examined'
          }
          icon={<Copy size={18} />}
        />
        <Stat
          label="Type anomalies"
          value="—"
          detail="Validation engine connects in Phase 5"
          icon={<ScanLine size={18} />}
        />
      </div>
      <div className="two-column cleaning-layout">
        <Panel
          title="Suggested transformations"
          subtitle="An explicit plan, one decision at a time"
        >
          <div className="step-label">
            <span>01</span>Review missing labels{' '}
            <Badge tone="copper">Suggestion</Badge>
          </div>
          {sample ? (
            <>
              <fieldset className="radio-list">
                <legend>How should missing region labels be handled?</legend>
                <label>
                  <input
                    type="radio"
                    name="clean-plan"
                    checked={selection === 'label'}
                    onChange={() => {
                      setSelection('label')
                      setReview('')
                    }}
                  />
                  <span>
                    <strong>Label as “Unknown”</strong>
                    <small>
                      Keep every row and make the missing context explicit.
                    </small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="clean-plan"
                    checked={selection === 'retain'}
                    onChange={() => {
                      setSelection('retain')
                      setReview('')
                    }}
                  />
                  <span>
                    <strong>Keep missing values</strong>
                    <small>
                      Defer the decision until the analysis requires it.
                    </small>
                  </span>
                </label>
              </fieldset>
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() =>
                    setReview(
                      'Marked for approval in this local preview only. Nothing was applied or saved.',
                    )
                  }
                >
                  <Check size={16} />
                  Preview approval
                </button>
                <button
                  className="button ghost"
                  onClick={() =>
                    setReview(
                      'Suggestion rejected in this local preview only. Original sample values are unchanged.',
                    )
                  }
                >
                  <X size={16} />
                  Preview rejection
                </button>
              </div>
              {review && (
                <p className="inline-status" role="status">
                  {review}
                </p>
              )}
            </>
          ) : (
            <Empty title="No quality profile connected">
              Issues and suggestions will be grounded in a real dataset profile
              in Phase 5.
            </Empty>
          )}
          <details>
            <summary>Why approval matters</summary>
            <p>
              Replacing missing values can change interpretation. Review the
              proposed operation and its scope before creating a derived
              version. Source data must remain immutable.
            </p>
          </details>
        </Panel>
        <Panel
          title="Before & proposed after"
          subtitle="A visual explanation, not an execution result"
        >
          <div className="comparison">
            <div>
              <span className="eyebrow">ORIGINAL SAMPLE</span>
              <h3>Region</h3>
              <div className="cell-preview">{sample ? 'null' : 'No value'}</div>
              <small>
                SO-1006 · SO-1011{' '}
                {sample ? '(sample)' : '(illustrative row IDs)'}
              </small>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
            <div>
              <span className="eyebrow">PROPOSED PREVIEW</span>
              <h3>Region</h3>
              <div className="cell-preview proposed">
                {sample
                  ? selection === 'label'
                    ? 'Unknown'
                    : 'null (unchanged)'
                  : 'No proposed value'}
              </div>
              <small>
                {sample && selection === 'label'
                  ? 'Two cells would change'
                  : 'No changes proposed'}
              </small>
            </div>
          </div>
          <div className="version-entry">
            <span className="timeline-dot" />
            <div>
              <h3>Version history</h3>
              <p>
                {sample
                  ? 'Sample v1 remains unchanged.'
                  : 'No connected dataset versions.'}
              </p>
              <Badge>No derived version created</Badge>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}
