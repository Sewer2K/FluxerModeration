export interface EmbedFieldDraft {
  name: string;
  value: string;
  inline: boolean;
}

export interface EmbedDraft {
  title: string;
  description: string;
  color: string;
  url: string;
  footer: string;
  thumbnail: string;
  image: string;
  fields: EmbedFieldDraft[];
}

export function createEmptyEmbedDraft(): EmbedDraft {
  return {
    title: '',
    description: '',
    color: '#5865f2',
    url: '',
    footer: '',
    thumbnail: '',
    image: '',
    fields: [],
  };
}

export function embedDraftToPayload(draft: EmbedDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (draft.title.trim()) payload.title = draft.title.trim();
  if (draft.description.trim()) payload.description = draft.description.trim();
  if (draft.color.trim()) payload.color = draft.color.trim();
  if (draft.url.trim()) payload.url = draft.url.trim();
  if (draft.footer.trim()) payload.footer = draft.footer.trim();
  if (draft.thumbnail.trim()) payload.thumbnail = draft.thumbnail.trim();
  if (draft.image.trim()) payload.image = draft.image.trim();

  const fields = draft.fields
    .filter((field) => field.name.trim() && field.value.trim())
    .map((field) => ({
      name: field.name.trim(),
      value: field.value,
      inline: field.inline,
    }));
  if (fields.length > 0) payload.fields = fields;

  return payload;
}

export function parseEmbedColorForPreview(color: string): string {
  const trimmed = color.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  return '#5865f2';
}
