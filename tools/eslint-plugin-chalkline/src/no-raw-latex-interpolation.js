/**
 * chalkline/no-raw-latex-interpolation
 *
 * Content reaches LaTeX only through escapeText() and sanitizeMath(), which
 * return the branded SafeLatex type, and LaTeX is assembled only with the
 * `tex` tagged template, whose interpolations must be SafeLatex. This rule
 * closes the gaps the type system leaves open:
 *
 * - template literals with interpolations that are not tagged `tex`;
 * - string concatenation with a literal that looks like LaTeX (contains a
 *   backslash);
 * - casts to SafeLatex.
 *
 * It is enabled for LaTeX-producing code (packages/latex, packages/presets)
 * except packages/latex/src/safe/, which implements the escaping itself.
 */

/** @param {import('estree').Node | undefined | null} node */
function hasBackslash(node) {
  if (!node) return false;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value.includes('\\');
  if (node.type === 'TemplateLiteral') return node.quasis.some((q) => q.value.raw.includes('\\'));
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noRawLatexInterpolation = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow building LaTeX from unescaped strings; use tex`` with SafeLatex values.',
    },
    schema: [],
    messages: {
      rawTemplate:
        'Template literals with interpolations may not build LaTeX. Use the `tex` tag with SafeLatex values (escapeText(), sanitizeMath()).',
      rawConcat:
        'Do not concatenate LaTeX strings. Use the `tex` tag or joinLatex() with SafeLatex values.',
      unsafeCast: 'Do not cast to SafeLatex outside packages/latex/src/safe/.',
    },
  },
  create(context) {
    return {
      TemplateLiteral(node) {
        if (node.expressions.length === 0) return;
        const parent = /** @type {any} */ (node).parent;
        const taggedTex =
          parent &&
          parent.type === 'TaggedTemplateExpression' &&
          parent.quasi === node &&
          parent.tag.type === 'Identifier' &&
          parent.tag.name === 'tex';
        if (!taggedTex) context.report({ node, messageId: 'rawTemplate' });
      },
      BinaryExpression(node) {
        if (node.operator !== '+') return;
        if (hasBackslash(node.left) || hasBackslash(/** @type {any} */ (node.right))) {
          context.report({ node, messageId: 'rawConcat' });
        }
      },
      /** @param {any} node */
      'TSAsExpression, TSTypeAssertion'(node) {
        const annotation = node.typeAnnotation;
        if (
          annotation &&
          annotation.type === 'TSTypeReference' &&
          annotation.typeName.type === 'Identifier' &&
          annotation.typeName.name === 'SafeLatex'
        ) {
          context.report({ node, messageId: 'unsafeCast' });
        }
      },
    };
  },
};
