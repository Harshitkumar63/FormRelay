/**
 * Utilities for deep comparison, object flattening, and 3-way merge conflict detection.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function flattenObject(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(val)) {
      Object.assign(result, flattenObject(val, fullKey))
    } else {
      result[fullKey] = val
    }
  }

  return result
}

export function unflattenObject(
  flat: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.')
    let current: any = result
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current) || !isPlainObject(current[part])) {
        current[part] = {}
      }
      current = current[part]
    }
    current[parts[parts.length - 1]] = val
  }

  return result
}

export function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => areValuesEqual(item, b[i]))
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => areValuesEqual(a[k], b[k]))
  }

  return false
}

export interface MergeAnalysis {
  canAutoMerge: boolean
  conflictingFields: string[]
  mergedData: Record<string, unknown>
  fieldDetails: Array<{
    path: string
    baseValue: unknown
    localValue: unknown
    serverValue: unknown
    isConflict: boolean
    resolvedTo?: 'local' | 'server' | 'unchanged'
  }>
}

/**
 * Perform a 3-way merge between base, local, and server data.
 */
export function analyze3WayMerge(
  baseData: Record<string, unknown>,
  localData: Record<string, unknown>,
  serverData: Record<string, unknown>
): MergeAnalysis {
  const flatBase = flattenObject(baseData)
  const flatLocal = flattenObject(localData)
  const flatServer = flattenObject(serverData)

  const allKeys = Array.from(
    new Set([...Object.keys(flatBase), ...Object.keys(flatLocal), ...Object.keys(flatServer)])
  ).sort()

  const conflictingFields: string[] = []
  const mergedFlat: Record<string, unknown> = {}
  const fieldDetails: MergeAnalysis['fieldDetails'] = []

  for (const key of allKeys) {
    const baseVal = flatBase[key]
    const localVal = flatLocal[key]
    const serverVal = flatServer[key]

    const localChanged = !areValuesEqual(localVal, baseVal)
    const serverChanged = !areValuesEqual(serverVal, baseVal)

    if (localChanged && serverChanged) {
      if (areValuesEqual(localVal, serverVal)) {
        // Both changed to the exact same value
        mergedFlat[key] = localVal
        fieldDetails.push({
          path: key,
          baseValue: baseVal,
          localValue: localVal,
          serverValue: serverVal,
          isConflict: false,
          resolvedTo: 'local',
        })
      } else {
        // True conflict: both changed to different values!
        conflictingFields.push(key)
        mergedFlat[key] = serverVal // default to server as placeholder until resolved
        fieldDetails.push({
          path: key,
          baseValue: baseVal,
          localValue: localVal,
          serverValue: serverVal,
          isConflict: true,
        })
      }
    } else if (localChanged) {
      // Only local changed: take local
      mergedFlat[key] = localVal
      fieldDetails.push({
        path: key,
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
        isConflict: false,
        resolvedTo: 'local',
      })
    } else if (serverChanged) {
      // Only server changed: take server
      mergedFlat[key] = serverVal
      fieldDetails.push({
        path: key,
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
        isConflict: false,
        resolvedTo: 'server',
      })
    } else {
      // Neither changed
      mergedFlat[key] = baseVal
      fieldDetails.push({
        path: key,
        baseValue: baseVal,
        localValue: localVal,
        serverValue: serverVal,
        isConflict: false,
        resolvedTo: 'unchanged',
      })
    }
  }

  return {
    canAutoMerge: conflictingFields.length === 0,
    conflictingFields,
    mergedData: unflattenObject(mergedFlat),
    fieldDetails,
  }
}

/**
 * Apply user field resolutions to produce final resolved data.
 */
export function applyResolutions(
  baseData: Record<string, unknown>,
  localData: Record<string, unknown>,
  serverData: Record<string, unknown>,
  resolutions: Record<string, 'local' | 'server' | unknown>
): Record<string, unknown> {
  const analysis = analyze3WayMerge(baseData, localData, serverData)
  const flatMerged = flattenObject(analysis.mergedData)
  const flatLocal = flattenObject(localData)
  const flatServer = flattenObject(serverData)

  for (const [field, choice] of Object.entries(resolutions)) {
    if (choice === 'local') {
      flatMerged[field] = flatLocal[field]
    } else if (choice === 'server') {
      flatMerged[field] = flatServer[field]
    } else {
      flatMerged[field] = choice
    }
  }

  return unflattenObject(flatMerged)
}
