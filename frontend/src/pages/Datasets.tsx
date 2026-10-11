import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
  ArrowRight,
  Database,
  FileSpreadsheet,
  UploadCloud,
} from 'lucide-react'
import { usePreview } from '../app/preview'
import {
  Badge,
  DataTable,
  Empty,
  Notice,
  PageHeader,
  Panel,
  TabPanel,
  Tabs,
} from '../components/ui'

export default function Datasets() {
  const { id } = useParams()
  const { fixture } = usePreview()
  const [tab, setTab] = useState('preview')
  const [dragging, setDragging] = useState(false)
  const [fileNote, setFileNote] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const sample = fixture && (!id || id === fixture.dataset.id) ? fixture : null
  function selectFile(file?: File) {
    if (!file) return
    setFileNote(
      !/\.(csv|xlsx)$/i.test(file.name)
        ? 'Unsupported format. Choose a CSV or XLSX file. No file was uploaded.'
        : file.size > 25_000_000
          ? 'This file exceeds the planned 25 MB limit. No file was uploaded.'
          : `Selected locally: ${file.name}. Upload is unavailable until Phase 4. The file was not read, sent or saved.`,
    )
  }
  return (
    <>
      <PageHeader
        eyebrow="DATA FOUNDATION"
        title={
          id
            ? sample
              ? 'Retail operations'
              : 'Dataset workspace'
            : 'Your datasets'
        }
        description="Understand the source before you explore the possibilities."
        actions={
          id && (
            <Link className="button secondary" to="/datasets">
              All datasets
            </Link>
          )
        }
      />
      <Notice>
        Dataset ingestion connects in Phase 4.{' '}
        {sample
          ? 'All values below are synthetic development fixtures.'
          : 'No datasets have been fetched from a backend.'}
      </Notice>
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          selectFile(e.dataTransfer.files[0])
        }}
      >
        <div className="upload-icon">
          <UploadCloud size={29} />
        </div>
        <div>
          <h2>Every insight begins with your data.</h2>
          <p>Drop a file to preview selection, or browse from your device.</p>
          <small>
            CSV or XLSX · Planned limit 25 MB · No upload in this preview
          </small>
        </div>
        <button
          className="button secondary"
          onClick={() => input.current?.click()}
        >
          Choose a file
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose dataset file"
          onChange={(e) => {
            selectFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {fileNote && (
        <div role="status">
          <Notice>{fileNote}</Notice>
        </div>
      )}
      {!sample ? (
        <Panel
          title={id ? 'Dataset not available' : 'Dataset library'}
          subtitle="A home for your original sources"
        >
          <Empty
            title={
              id
                ? 'No connected dataset at this address.'
                : 'Your workspace has room to grow.'
            }
          >
            {id
              ? 'This preview cannot retrieve dataset IDs. Open the sample workspace from the banner to inspect the synthetic retail dataset.'
              : 'Connect ingestion in Phase 4, or explore a development sample using the banner above.'}
          </Empty>
        </Panel>
      ) : !id ? (
        <Panel
          title="Development samples"
          subtitle="Isolated fixtures, never uploaded data"
          action={<Badge tone="copper">1 sample</Badge>}
        >
          <Link className="dataset-list-card" to="/datasets/sample-retail">
            <FileSpreadsheet size={30} />
            <div>
              <h3>Retail operations</h3>
              <p>12 rows · 6 columns · CSV · Sample v1</p>
            </div>
            <Badge tone="copper">Synthetic</Badge>
            <ArrowRight size={18} />
          </Link>
        </Panel>
      ) : (
        <>
          <div className="dataset-meta">
            <span>
              <Database size={16} />
              12 records
            </span>
            <span>6 columns</span>
            <span>1.24 KB illustrative file size</span>
            <Badge tone="copper">Sample v1 · Synthetic</Badge>
            <Link to="/datasets/sample-retail/clean" className="text-link">
              Open Cleaning Studio <ArrowRight size={15} />
            </Link>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'preview', label: 'Data preview' },
              { id: 'columns', label: 'Column profile' },
              { id: 'versions', label: 'Versions & source' },
            ]}
          />
          <TabPanel id={tab}>
            {tab === 'preview' ? (
              <Panel
                title="A closer look at your data"
                subtitle="12 synthetic rows · All rows available through pagination"
              >
                <DataTable
                  key="records"
                  rows={sample.rows}
                  columns={Object.keys(sample.rows[0]).map((key) => ({
                    key,
                    label:
                      key === 'revenue'
                        ? 'Revenue (USD)'
                        : key[0].toUpperCase() + key.slice(1),
                  }))}
                  caption="Sample retail records"
                />
              </Panel>
            ) : tab === 'columns' ? (
              <Panel
                title="Column profile"
                subtitle="Descriptions of this fixed sample, not a live profiling result"
              >
                <DataTable
                  key="columns"
                  caption="Sample column profile"
                  rows={Object.keys(sample.rows[0]).map((key) => ({
                    column: key,
                    type:
                      typeof sample.rows[0][key] === 'number'
                        ? 'Numeric'
                        : 'Text',
                    missing: sample.rows.filter((row) => row[key] === null)
                      .length,
                    observations:
                      key === 'region'
                        ? 'Two missing labels'
                        : 'No missing values in sample',
                  }))}
                  columns={[
                    { key: 'column', label: 'Column' },
                    { key: 'type', label: 'Data type' },
                    { key: 'missing', label: 'Missing cells' },
                    { key: 'observations', label: 'Observation' },
                  ]}
                />
              </Panel>
            ) : (
              <Panel
                title="Version history"
                subtitle="No cleaned or uploaded versions exist"
              >
                <div className="version-entry">
                  <span className="timeline-dot" />
                  <div>
                    <h3>
                      Sample v1 <Badge tone="copper">Fixture</Badge>
                    </h3>
                    <p>
                      Original synthetic values bundled only with the
                      development server.
                    </p>
                    <small>
                      No upload date, checksum or stored artifact exists for
                      this illustration.
                    </small>
                  </div>
                </div>
              </Panel>
            )}
          </TabPanel>
        </>
      )}
    </>
  )
}
