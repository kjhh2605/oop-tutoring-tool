import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { java } from '@codemirror/lang-java'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

// Like codemirror's basicSetup, minus autocompletion (out of scope) and history (Yjs UndoManager handles undo).
export function javaEditorSetup({ readOnly = false }: { readOnly?: boolean } = {}): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    lintGutter(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    // Mod-Enter runs the program (handled by the workspace), so keep it from inserting a blank line.
    keymap.of([{ key: 'Mod-Enter', run: () => true }]),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap, indentWithTab]),
    java(),
    oneDark,
    EditorView.theme({
      '&': { height: '100%', fontSize: readOnly ? '12px' : '15px' },
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
      '.cm-content': { paddingTop: '14px' }, // room for the caret name label on the first line
      '.cm-tutor-mark': { backgroundColor: 'rgba(255, 146, 43, 0.22)', borderBottom: '1px solid rgba(255, 146, 43, 0.7)' },
      // Only two people share a workspace, so always show whose caret it is.
      '& .cm-ySelectionInfo': { opacity: '1', top: '-1.15em', fontSize: '11px', padding: '0 3px', borderRadius: '3px' },
    }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ]
}
