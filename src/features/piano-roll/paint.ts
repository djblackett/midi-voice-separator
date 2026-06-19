export function shouldPaintNote(
  note: { id: string; voiceId: string },
  activeVoiceId: string,
  alreadyPainted: ReadonlySet<string>,
): boolean {
  return note.voiceId !== activeVoiceId && !alreadyPainted.has(note.id);
}
