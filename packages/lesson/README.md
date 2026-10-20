# Lesson format

A plain-text way to write a lesson by hand. `pnpm preview` turns a lesson file into handouts; tests and the corpus use the same format for expected documents. The parser is strict: anything ambiguous is an error with a line number.

```text
---
title: Solving quadratic equations
course: Algebra II, Period 3
teacher: Ms. Rivera
date: 2026-10-20
unit: Unit 4: Quadratics
lang: en
---

# Quadratic equations

Today we solve $ax^2 + bx + c = 0$ where $a \neq 0$.

::: definition Quadratic equation
A **quadratic equation** is a polynomial equation of degree 2.
:::

::: theorem Quadratic formula {key}
$$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$
:::

::: problem 5 points
Solve by factoring.
(a) $x^2 + 7x + 12 = 0$
Solution: $$ (x + 3)(x + 4) = 0 $$
Answer: $x = -3$ or $x = -4$
(b) $x^2 - 9 = 0$
Answer: $x = \pm 3$
:::
```

## Syntax

| Write                                               | Meaning                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `---` … `---` at the top                            | Front matter: `title`, `course`, `teacher`, `date` (yyyy-mm-dd), optional `unit`, `lang` (en, es, fr, de, pt; default en) |
| `# Heading`                                         | A new section                                                                                                             |
| Lines of text                                       | A paragraph; a blank line ends it                                                                                         |
| `$x^2$`                                             | Inline math (LaTeX). `\$` is a literal dollar sign in text                                                                |
| `**bold**`, `*italic*`                              | Emphasis in text                                                                                                          |
| `$$ x = 1 $$`                                       | Display math on one line                                                                                                  |
| `$$`, one line per step, `$$`                       | A derivation, aligned at the first `=` (or other relation) on each line                                                   |
| `- item`, `1. item`                                 | Lists                                                                                                                     |
| `\| a \| b \|` rows, `\|---\|---\|` after the first | A table, with a header row when the separator is present                                                                  |
| `![alt text](asset-name)`                           | A board image: `asset-name.png` next to the lesson, or a grey placeholder                                                 |
| `::: definition Title` … `:::`                      | A callout: `definition`, `theorem`, `note`, `example`, `announcement`; the title is optional                              |
| `::: problem` or `::: problem 5 points` … `:::`     | A problem; its text is the prompt                                                                                         |
| `(a)`, `(b)` inside a problem                       | Parts                                                                                                                     |
| `Solution:`                                         | The worked solution of the current part or problem (or of an `example`); content can follow on the same line              |
| `Answer: …`                                         | The final answer, on one line                                                                                             |

Tags go at the end of a line in braces, and can be combined (`{key, check}`):

| Tag             | Effect                                                             |
| --------------- | ------------------------------------------------------------------ |
| `{key}`         | The teacher's "Key result" tag: Guided Notes turns it into a blank |
| `{check}`       | Marks the block as low confidence, as recognition would            |
| `{crossed-out}` | Excluded as crossed-out work                                       |
| `{excluded}`    | Excluded by the teacher                                            |

Put a tag on a paragraph's last line, on a one-line `$$ … $$`, on the closing `$$` of a derivation, after an image, on an `Answer:` line, or on a `:::` opening line.
