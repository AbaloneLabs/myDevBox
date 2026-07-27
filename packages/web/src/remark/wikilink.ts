/**
 * remark plugin: [[Target]] → markdown link to #wiki/Target
 *
 * Only the AST transform happens here; click handling (selectWikiPage) is
 * wired in WikiPanel via an anchor-click listener. Uses local mdast-shaped
 * types to avoid an @types/mdast dependency.
 */

interface MdNode {
  type: string
  value?: string
  url?: string
  data?: { hProperties?: { className?: string } }
  children?: MdNode[]
}

interface Parent {
  children: MdNode[]
}

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g

function isParent(node: MdNode): node is Parent & MdNode {
  return Array.isArray((node as Parent).children)
}

/** Split a text value into text + wikilink link nodes. null = no match. */
function splitWikilinks(value: string): MdNode[] | null {
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((m = WIKILINK_RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    const target = m[1].trim()
    out.push({
      type: 'link',
      url: `#wiki/${target}`,
      data: { hProperties: { className: 'wikilink' } },
      children: [{ type: 'text', value: target }],
    })
    last = m.index + m[0].length
  }
  if (last === 0) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function visit(node: Parent & MdNode): void {
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const replaced = splitWikilinks(child.value)
      if (replaced) {
        for (const r of replaced) next.push(r)
        continue
      }
    }
    if (isParent(child)) visit(child)
    next.push(child)
  }
  node.children = next
}

export function remarkWikilink(): (tree: MdNode) => void {
  return (tree: MdNode) => {
    if (isParent(tree)) visit(tree)
  }
}
