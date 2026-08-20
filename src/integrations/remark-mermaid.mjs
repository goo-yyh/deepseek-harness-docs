function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function visit(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'code' && node.lang === 'mermaid') {
    node.type = 'html'
    node.value = `<pre class="mermaid" data-mermaid-source>${escapeHtml(node.value)}</pre>`
    delete node.lang
    delete node.meta
  }
  if (Array.isArray(node.children)) node.children.forEach(visit)
}

export default function remarkMermaid() {
  return visit
}
