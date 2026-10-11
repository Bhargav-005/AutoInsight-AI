import { createContext, useContext } from 'react'
import type { WorkspaceFixture } from '../types/domain'

export const PreviewContext = createContext<{
  fixture: WorkspaceFixture | null
  loading: boolean
  toggle: () => void
}>({ fixture: null, loading: false, toggle: () => {} })
export const usePreview = () => useContext(PreviewContext)
