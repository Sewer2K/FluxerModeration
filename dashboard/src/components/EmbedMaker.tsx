import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { Loader2, Plus, Send, Trash2, Layers } from 'lucide-react';
import type { GuildDetail } from '../lib/api';
import { api } from '../lib/api';
import { buildWelcomeChannelSelectData } from '../lib/welcomeChannelSelect';
import {
  createEmptyEmbedDraft,
  embedDraftToPayload,
  parseEmbedColorForPreview,
  type EmbedFieldDraft,
} from '../lib/embedMaker';
import { fluxerApiBaseUrl } from '../lib/fluxerUrls';

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true';

function ChannelSelect({
  channels,
  value,
  onChange,
}: {
  channels: GuildDetail['channels'];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { options, selectableIds } = buildWelcomeChannelSelectData(channels);
  const needsFallback = !!value && value !== '__none__' && !selectableIds.includes(value);

  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger>
        <SelectValue placeholder="Select channel" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Select channel</SelectItem>
        {needsFallback && (
          <SelectItem key={value} value={value!}>
            #{channels.find((c) => c.id === value)?.name || value}
          </SelectItem>
        )}
        {options.map((item) =>
          item.isCategory ? (
            <div key={item.id} className="px-2 py-1.5 text-xs font-semibold text-muted-foreground select-none">
              {item.label}
            </div>
          ) : (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

function EmbedPreview({ draft }: { draft: ReturnType<typeof createEmptyEmbedDraft> }) {
  const accent = parseEmbedColorForPreview(draft.color);
  const fields = draft.fields.filter((field) => field.name.trim() || field.value.trim());

  return (
    <div className="rounded-lg overflow-hidden border border-white/10">
      <div className="flex">
        <div className="w-1 shrink-0" style={{ backgroundColor: accent }} />
        <div className="p-4 space-y-2 flex-1 bg-[hsl(var(--muted))] min-h-[120px]">
          {draft.title && <p className="text-sm font-semibold text-white">{draft.title}</p>}
          {draft.description && <p className="text-xs text-gray-300 whitespace-pre-wrap">{draft.description}</p>}
          {fields.map((field, index) => (
            <div key={index} className={field.inline ? 'inline-block align-top w-[48%] mr-2' : 'block'}>
              <p className="text-[11px] font-semibold text-white">{field.name || 'Field'}</p>
              <p className="text-[11px] text-gray-400 whitespace-pre-wrap">{field.value || '...'}</p>
            </div>
          ))}
          {draft.image && (
            <div className="pt-2">
              <img src={draft.image} alt="" className="max-h-32 rounded object-cover" />
            </div>
          )}
          {draft.footer && <p className="text-[10px] text-gray-500 pt-1 border-t border-white/5">{draft.footer}</p>}
          {!draft.title && !draft.description && fields.length === 0 && (
            <p className="text-xs text-gray-500 italic">Preview shows up here</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface EmbedMakerProps {
  guild: GuildDetail;
  guildId: string;
}

export default function EmbedMaker({ guild, guildId }: EmbedMakerProps) {
  const [draft, setDraft] = useState(createEmptyEmbedDraft);
  const [sendAs, setSendAs] = useState<'bot' | 'webhook'>('bot');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookName, setWebhookName] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const payload = useMemo(() => embedDraftToPayload(draft), [draft]);

  const updateField = (index: number, patch: Partial<EmbedFieldDraft>) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((field, idx) => (idx === index ? { ...field, ...patch } : field)),
    }));
  };

  const handleSend = async () => {
    setNotice(null);
    setSending(true);
    try {
      if (MOCK_MODE) {
        setNotice({ type: 'success', message: 'Embed sent (mock mode)' });
        return;
      }

      const body: Record<string, unknown> = {
        sendAs,
        embed: payload,
        content: content.trim() || null,
      };

      if (sendAs === 'bot') {
        if (!channelId) throw new Error('Pick a channel');
        body.channelId = channelId;
      } else {
        body.webhookUrl = webhookUrl.trim();
        body.webhookName = webhookName.trim() || null;
      }

      await api.post(`/guilds/${guildId}/send-embed`, body);
      setNotice({ type: 'success', message: sendAs === 'bot' ? 'Embed sent through ClaudeCityMod' : 'Embed sent via webhook' });
    } catch (err: any) {
      setNotice({ type: 'error', message: err?.message || 'Failed to send embed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Embed Maker
          </CardTitle>
          <CardDescription>Build a Fluxer embed and send it through the bot or your own webhook</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={draft.title} onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                  rows={4}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={parseEmbedColorForPreview(draft.color)}
                      onChange={(e) => setDraft((p) => ({ ...p, color: e.target.value }))}
                      className="h-9 w-9 rounded border border-white/10 bg-transparent cursor-pointer"
                    />
                    <Input
                      value={draft.color}
                      onChange={(e) => setDraft((p) => ({ ...p, color: e.target.value }))}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Title URL</Label>
                  <Input
                    value={draft.url}
                    onChange={(e) => setDraft((p) => ({ ...p, url: e.target.value }))}
                    placeholder="https://fluxer.app/..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Thumbnail URL</Label>
                  <Input
                    value={draft.thumbnail}
                    onChange={(e) => setDraft((p) => ({ ...p, thumbnail: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Image URL</Label>
                  <Input
                    value={draft.image}
                    onChange={(e) => setDraft((p) => ({ ...p, image: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Footer</Label>
                <Input value={draft.footer} onChange={(e) => setDraft((p) => ({ ...p, footer: e.target.value }))} />
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Fields</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        fields: [...p.fields, { name: '', value: '', inline: false }],
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add field
                  </Button>
                </div>
                {draft.fields.map((field, index) => (
                  <div key={index} className="rounded-lg border border-white/10 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Input
                        value={field.name}
                        onChange={(e) => updateField(index, { name: e.target.value })}
                        placeholder="Field name"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDraft((p) => ({ ...p, fields: p.fields.filter((_, idx) => idx !== index) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={field.value}
                      onChange={(e) => updateField(index, { value: e.target.value })}
                      placeholder="Field value"
                      rows={2}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Inline</span>
                      <Switch checked={field.inline} onCheckedChange={(v) => updateField(index, { inline: v })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Preview</Label>
              <EmbedPreview draft={draft} />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Send as</Label>
                <Select value={sendAs} onValueChange={(v) => setSendAs(v as 'bot' | 'webhook')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bot">ClaudeCityMod bot</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message content (optional)</Label>
                <Input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Text above the embed"
                />
              </div>
            </div>

            {sendAs === 'bot' ? (
              <div className="space-y-2">
                <Label>Channel</Label>
                <ChannelSelect channels={guild.channels} value={channelId} onChange={setChannelId} />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder={`${fluxerApiBaseUrl()}/webhooks/<id>/<token>`}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Webhook name (optional)</Label>
                  <Input
                    value={webhookName}
                    onChange={(e) => setWebhookName(e.target.value)}
                    placeholder="Announcement Bot"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleSend} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Send embed
              </Button>
              {notice && (
                <p className={`text-sm ${notice.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {notice.message}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
