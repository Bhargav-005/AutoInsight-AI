import { useRef, type CSSProperties } from 'react'
import { BarChart3, Database, FileText, Globe2, Code2, Sheet, Check, Network } from 'lucide-react'

export function BrandMark() { return <span className="lp-brand-symbol"><BarChart3 size={24} strokeWidth={1.6} /></span> }
export function Chart({ line = false }: { line?: boolean }) {
  return line ? <svg viewBox="0 0 180 90" className="lp-chart" aria-hidden="true"><path className="chart-grid" d="M10 20H175M10 45H175M10 70H175M30 10V80M65 10V80M100 10V80M135 10V80"/><path className="chart-area" d="M12 78L40 57L66 65L92 36L118 44L145 23L169 7V80H12Z"/><path className="chart-line" d="M12 78L40 57L66 65L92 36L118 44L145 23L169 7"/>{[[12,78],[40,57],[66,65],[92,36],[118,44],[145,23],[169,7]].map(([x,y])=><circle key={x} cx={x} cy={y} r="3"/>)}</svg> : <div className="lp-bars" aria-hidden="true">{[26,40,31,55,47,66,59,85,73].map((height,index)=><i key={index} style={{'--bar': `${height}%`, '--i':index} as CSSProperties}/>)}</div>
}
export function FlowVisual() {
  const stage = useRef<HTMLDivElement>(null)
  return <div className="lp-flow-visual" ref={stage} onPointerMove={event => {
    if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--tilt', `${((event.clientX - rect.left) / rect.width - 0.5) * 10}deg`)
  }} onPointerLeave={() => stage.current?.style.setProperty('--tilt','0deg')}>
    <div className="lp-paper-cloud" aria-hidden="true">{Array.from({length:8},(_,i)=><div key={i} style={{'--i':i, '--x':`${8+(i%3)*28}%`, '--y':`${2+i*10}%`} as CSSProperties}><span/><span/><Chart/></div>)}</div>
    <svg className="lp-flow-lines" viewBox="0 0 800 420" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="flow-gradient"><stop stopColor="#6ca1a3"/><stop offset=".5" stopColor="#c77d48"/><stop offset="1" stopColor="#e8b58c"/></linearGradient></defs>{[0,1,2,3,4,5].map((n)=><path key={n} style={{'--i':n} as CSSProperties} d={`M160 ${80+n*48} C310 ${80+n*48},280 210,400 210 S520 ${45+n*62},660 ${45+n*62}`}/>)}</svg>
    <div className="lp-flow-source lp-glass"><strong>Data sources</strong>{[[Database,'Databases'],[Sheet,'Spreadsheets'],[FileText,'Documents'],[Code2,'Supported APIs'],[Globe2,'Research context']].map(([Icon,label])=>{ const I = Icon as typeof Database; return <span key={String(label)}><I size={21}/>{String(label)}</span>})}</div>
    <div className="lp-flow-cube"><div><BrandMark/><strong>AutoInsight AI</strong><span>A connected workspace</span></div></div>
    <div className="lp-flow-results"><div className="lp-glass"><strong>Insights</strong><Chart/></div><div className="lp-glass lp-explanation"><strong>Explanations</strong><span/><span/><span/></div><div className="lp-glass"><strong>Actionable results</strong><Chart line/></div></div>
  </div>
}
export function MiniVisual({ index }: { index:number }) {
  return <div className={`lp-mini lp-mini-${index}`} aria-hidden="true">
    {(index===0 || index===4 || index===5) && <div className="lp-documents">{[0,1,2].map(i=><div className="lp-document" key={i} style={{'--i':i} as CSSProperties}><span className="doc-title"/><span/><span/>{i===2 || index===5?<Chart/>:<><span/><span/></>}</div>)}{index===4&&<Globe2 className="lp-knowledge-globe"/>}</div>}
    {index===1&&<div className="lp-cubes">{Array.from({length:9},(_,i)=><i key={i} style={{'--i':i} as CSSProperties}/>)}</div>}
    {index===2&&<div className="lp-architecture-bars">{[25,45,38,70,95].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}<Chart line/></div>}
    {index===3&&<div className="lp-model-visual"><Network/><div className="lp-model-base"/>{[0,1,2,3,4].map(i=><i key={i} style={{'--i':i, '--x':`${15+i*16}%`, '--y':`${20+(i%3)*22}%`} as CSSProperties}/>)}</div>}
  </div>
}
export function EvidenceVisual() { return <div className="lp-evidence-visual"><span>Evidence, connected.</span><div><FileText/><i/><BarChart3/><i/><Check/></div><small>Source → computation → finding</small></div> }
