const datasetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isDatasetId(value: string | undefined): value is string {
  return value !== undefined && datasetIdPattern.test(value)
}

export function datasetIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:datasets|analysis)\/([^/]+)(?:\/clean)?$/)
  return match && isDatasetId(match[1]) ? match[1] : null
}
