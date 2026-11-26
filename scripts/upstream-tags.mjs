// Preview tags rank below their stable release. Only stable tags are candidates.
export const parseTagVersion = (tag) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/.exec(tag)
  return match ? [...match.slice(1, 4).map(Number), match[4] ? 0 : 1] : null
}

export function stableReleaseTags(refs) {
  const tagRefs = new Map(refs.trim().split('\n').filter(Boolean).map((line) => {
    const [object, ref] = line.split('\t')
    return [ref, object]
  }))
  return [...tagRefs]
    .filter(([ref]) => !ref.endsWith('^{}'))
    .map(([ref, object]) => ({
      // Annotated tags are pinned to the commit that build.mjs will check.
      commit: tagRefs.get(ref + '^{}') ?? object,
      tag: ref.replace('refs/tags/', ''),
    }))
    .filter(({ tag }) => parseTagVersion(tag)?.[3] === 1)
}
