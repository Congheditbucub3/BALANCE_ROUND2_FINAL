// Small, dependency-free Markdown renderer for AI responses. It escapes all
// model-provided HTML before adding a deliberately limited set of formatting
// tags, so an answer cannot inject scripts into the page.
(function () {
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]));
  }

  function inlineMarkdown(value) {
    const escaped = escapeHtml(value);
    return escaped
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  }

  function renderSafeMarkdown(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let listType = null;

    function closeList() {
      if (listType) html.push(`</${listType}>`);
      listType = null;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

      // Keep multi-line display equations in one element. KaTeX needs the
      // opening and closing delimiters inside the same text node.
      const trimmed = line.trim();
      if (trimmed === '\\[' || trimmed === '$$') {
        const closingDelimiter = trimmed === '\\[' ? '\\]' : '$$';
        const mathLines = [];
        let closed = false;
        while (index + 1 < lines.length) {
          index += 1;
          if (lines[index].trim() === closingDelimiter) {
            closed = true;
            break;
          }
          mathLines.push(lines[index]);
        }
        if (closed) {
          closeList();
          html.push(`<div class="math-display">${trimmed}${escapeHtml(mathLines.join('\n'))}${closingDelimiter}</div>`);
          continue;
        }
        // An unmatched delimiter is treated as normal text below, rather
        // than losing the student's equation.
        index -= mathLines.length;
      }

      if (!line.trim()) {
        closeList();
        continue;
      }
      if (heading) {
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (unordered || ordered) {
        const nextListType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextListType) closeList();
        if (!listType) {
          html.push(`<${nextListType}>`);
          listType = nextListType;
        }
        html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
        continue;
      }

      closeList();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    closeList();
    return html.join('');
  }

  function renderMath(element) {
    if (typeof window.renderMathInElement !== 'function') return;
    window.renderMathInElement(element, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  }

  window.renderSafeMarkdown = renderSafeMarkdown;
  window.renderAiMath = renderMath;
})();
