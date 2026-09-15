import type { Note, NoteContext } from './types';

export interface TaskLine {
  noteId: string;
  itemId: string;
  text: string;
  checked: boolean;
  context: NoteContext;
}

export function computeTasks(notes: Note[]): TaskLine[] {
  const lines: TaskLine[] = [];
  for (const n of notes) {
    for (const it of n.items) {
      lines.push({ noteId: n.id, itemId: it.id, text: it.text, checked: it.checked, context: n.context });
    }
  }
  lines.sort((a, b) => Number(a.checked) - Number(b.checked));
  return lines;
}
