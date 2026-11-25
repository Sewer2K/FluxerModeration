import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import {
  Award,
  BarChart3,
  Loader2,
  MessageSquare,
  Mic,
  Save,
  Shield,
  Smile,
  Sparkles,
  Trophy,
  ExternalLink,
  X,
} from 'lucide-react';
import type { GuildDetail, GuildSettings, LevelingSettings, LevelRole } from '../lib/api';
import { api } from '../lib/api';
import { buildLevelingSavePayload, MESSAGE_XP_QUALITY_PRESETS, normalizeLeveling } from '../lib/levelingSettings';
import { buildWelcomeChannelSelectData } from '../lib/welcomeChannelSelect';
import { leaderboardPublicUrl } from '../lib/publicLeaderboard';

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true';

interface Props {
  settings: GuildSettings;
  guild: GuildDetail;
  guildId: string;
  onSave: (patch: Partial<GuildSettings>) => void;
  saving?: boolean;
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function ChannelSelect({
  channels,
  value,
  onChange,
  placeholder = 'Select channel',
  allowNone = true,
}: {
  channels: GuildDetail['channels'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const { options, selectableIds } = useMemo(() => buildWelcomeChannelSelectData(channels), [channels]);
  const needsFallback = value && !selectableIds.includes(value);

  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value="__none__">None</SelectItem>}
        {needsFallback && value && (
          <SelectItem value={value}>#{channels.find((c) => c.id === value)?.name ?? value}</SelectItem>
        )}
        {options.map((opt) =>
          opt.isCategory ? (
            <div key={opt.id} className="px-2 py-1.5 text-xs font-semibold text-muted-foreground select-none">
              {opt.label}
            </div>
          ) : (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  placeholder = 'Select role',
}: {
  roles: GuildDetail['roles'];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? '__none__'} onValueChange={(v) => onChange(v === '__none__' ? null : v)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        {roles.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            @{r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function LevelingEditor({ settings, guild, guildId, onSave, saving }: Props) {
  const [leveling, setLeveling] = useState<LevelingSettings>(() => normalizeLeveling(settings.leveling));
  const [draftLevel, setDraftLevel] = useState('1');
  const [draftRoleId, setDraftRoleId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [testChannelId, setTestChannelId] = useState<string | null>(null);

  useEffect(() => {
    setLeveling(normalizeLeveling(settings.leveling));
  }, [settings.leveling]);

  useEffect(() => {
    if (MOCK_MODE) {
      setLeaderboard([
        { userId: '300000000000000001', level: 12, xp: 4200 },
        { userId: '300000000000000002', level: 9, xp: 2800 },
        { userId: '300000000000000003', level: 7, xp: 1900 },
      ]);
      return;
    }
    api
      .get<any[]>(`/guilds/${guildId}/leveling/leaderboard?limit=10`, { skipCache: true })
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [guildId]);

  const update = (patch: Partial<LevelingSettings>) => setLeveling((prev) => normalizeLeveling({ ...prev, ...patch }));
  const updateNested = <K extends keyof LevelingSettings>(key: K, patch: Partial<LevelingSettings[K]>) =>
    setLeveling((prev) => normalizeLeveling({ ...prev, [key]: { ...(prev[key] as object), ...patch } as any }));

  const roleName = (id: string) => guild.roles.find((r) => r.id === id)?.name ?? id;
  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? id;
  const publicLeaderboardUrl = useMemo(
    () => leaderboardPublicUrl(leveling, guildId),
    [leveling.leaderboardVanity, guildId],
  );

  const addLevelRole = () => {
    const level = Math.max(1, Math.min(1000, parseInt(draftLevel, 10) || 1));
    if (!draftRoleId) return;
    if (leveling.levelRoles.length >= 15) return;
    if (leveling.levelRoles.some((r) => r.level === level && r.roleId === draftRoleId)) return;
    update({ levelRoles: [...leveling.levelRoles, { level, roleId: draftRoleId }].sort((a, b) => a.level - b.level) });
    setDraftLevel('1');
    setDraftRoleId(null);
  };

  const handleSave = () => onSave(buildLevelingSavePayload(leveling));

  const handleResetXp = async () => {
    if (!confirm('Reset all member XP on this server? This cannot be undone.')) return;
    await api.post(`/guilds/${guildId}/leveling/reset`, {});
    setLeaderboard([]);
  };

  const handleTestLevelUp = async () => {
    if (!testChannelId) return;
    await api.post(`/guilds/${guildId}/leveling/test-levelup`, { channelId: testChannelId });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Leveling
          </CardTitle>
          <CardDescription>Reward active members with XP, levels, roles, and rank cards.</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Enable leveling"
            description="Master switch for XP tracking on this server."
            checked={leveling.enabled}
            onCheckedChange={(v) => update({ enabled: v })}
          />
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-semibold text-white mb-3">XP Options</h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Formula</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Curve</Label>
                <Select
                  value={leveling.formula.curve}
                  onValueChange={(v) => updateNested('formula', { curve: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="quadratic">Quadratic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput
                label="Multiplier"
                value={leveling.formula.multiplier}
                onChange={(v) => updateNested('formula', { multiplier: v })}
                min={0.1}
                max={10}
              />
              <div className="space-y-1.5">
                <Label>Max level</Label>
                <Input
                  placeholder="Unlimited"
                  value={leveling.formula.maxLevel ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    updateNested('formula', { maxLevel: raw ? Math.max(1, parseInt(raw, 10) || 1) : null });
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Message XP
              </CardTitle>
              <Switch
                checked={leveling.messageXp.enabled}
                onCheckedChange={(v) => updateNested('messageXp', { enabled: v })}
              />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Mode</Label>
                <Select
                  value={leveling.messageXp.mode}
                  onValueChange={(v) => updateNested('messageXp', { mode: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random XP per message</SelectItem>
                    <SelectItem value="per_word">XP per word</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput
                label="Min"
                value={leveling.messageXp.min}
                onChange={(v) => updateNested('messageXp', { min: v })}
                min={1}
              />
              <NumberInput
                label="Max"
                value={leveling.messageXp.max}
                onChange={(v) => updateNested('messageXp', { max: v })}
                min={1}
              />
              <NumberInput
                label="Cooldown (seconds)"
                value={leveling.messageXp.cooldownSeconds}
                onChange={(v) => updateNested('messageXp', { cooldownSeconds: v })}
                min={5}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4" /> XP Quality
                </CardTitle>
                <CardDescription className="mt-1">
                  Blocks spam and low-effort messages from earning XP. Skips are silent.
                </CardDescription>
              </div>
              <Switch
                checked={leveling.messageXp.quality.enabled}
                onCheckedChange={(v) =>
                  updateNested('messageXp', { quality: { ...leveling.messageXp.quality, enabled: v } })
                }
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['relaxed', 'balanced', 'strict'] as const).map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      updateNested('messageXp', {
                        quality: { ...leveling.messageXp.quality, ...MESSAGE_XP_QUALITY_PRESETS[preset] },
                      })
                    }
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberInput
                  label="Min characters"
                  value={leveling.messageXp.quality.minCharacters}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, minCharacters: v } })
                  }
                  min={0}
                />
                <NumberInput
                  label="Min words"
                  value={leveling.messageXp.quality.minWords}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, minWords: v } })
                  }
                  min={0}
                />
                <NumberInput
                  label="Min unique characters"
                  value={leveling.messageXp.quality.minUniqueCharacters}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, minUniqueCharacters: v } })
                  }
                  min={1}
                />
                <NumberInput
                  label="Max duplicate repeats"
                  value={leveling.messageXp.quality.maxDuplicateMatches}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, maxDuplicateMatches: v } })
                  }
                  min={1}
                />
                <NumberInput
                  label="Duplicate window (seconds)"
                  value={leveling.messageXp.quality.duplicateWindowSeconds}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, duplicateWindowSeconds: v } })
                  }
                  min={30}
                />
                <NumberInput
                  label="Burst window (seconds)"
                  value={leveling.messageXp.quality.burstWindowSeconds}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, burstWindowSeconds: v } })
                  }
                  min={5}
                />
                <NumberInput
                  label="Burst max messages"
                  value={leveling.messageXp.quality.burstMaxMessages}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, burstMaxMessages: v } })
                  }
                  min={2}
                />
                <NumberInput
                  label="Per-word cap"
                  value={leveling.messageXp.quality.maxWordsCounted}
                  onChange={(v) =>
                    updateNested('messageXp', { quality: { ...leveling.messageXp.quality, maxWordsCounted: v } })
                  }
                  min={1}
                />
              </div>
              <ToggleRow
                label="Ignore commands"
                description="Prefix commands do not earn message XP"
                checked={leveling.messageXp.quality.ignoreCommands}
                onCheckedChange={(v) =>
                  updateNested('messageXp', { quality: { ...leveling.messageXp.quality, ignoreCommands: v } })
                }
              />
              <ToggleRow
                label="Ignore emoji-only messages"
                checked={leveling.messageXp.quality.ignoreOnlyEmojis}
                onCheckedChange={(v) =>
                  updateNested('messageXp', { quality: { ...leveling.messageXp.quality, ignoreOnlyEmojis: v } })
                }
              />
              <ToggleRow
                label="Ignore attachment-only messages"
                description="When off, attachment-only messages can earn XP; text thresholds are skipped, but cooldown and anti-spam limits still apply"
                checked={leveling.messageXp.quality.ignoreOnlyAttachments}
                onCheckedChange={(v) =>
                  updateNested('messageXp', { quality: { ...leveling.messageXp.quality, ignoreOnlyAttachments: v } })
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Mic className="h-4 w-4" /> Voice XP
              </CardTitle>
              <Switch
                checked={leveling.voiceXp.enabled}
                onCheckedChange={(v) => updateNested('voiceXp', { enabled: v })}
              />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <NumberInput
                label="Min"
                value={leveling.voiceXp.min}
                onChange={(v) => updateNested('voiceXp', { min: v })}
                min={1}
              />
              <NumberInput
                label="Max"
                value={leveling.voiceXp.max}
                onChange={(v) => updateNested('voiceXp', { max: v })}
                min={1}
              />
              <NumberInput
                label="Cooldown (seconds)"
                value={leveling.voiceXp.cooldownSeconds}
                onChange={(v) => updateNested('voiceXp', { cooldownSeconds: v })}
                min={30}
              />
              <NumberInput
                label="Minimum members"
                value={leveling.voiceXp.minimumMembers}
                onChange={(v) => updateNested('voiceXp', { minimumMembers: v })}
                min={1}
              />
              <div className="col-span-2">
                <ToggleRow
                  label="Anti AFK"
                  description="Skip XP when self-muted and self-deafened."
                  checked={leveling.voiceXp.antiAfk}
                  onCheckedChange={(v) => updateNested('voiceXp', { antiAfk: v })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Smile className="h-4 w-4" /> Reaction XP
              </CardTitle>
              <Switch
                checked={leveling.reactionXp.enabled}
                onCheckedChange={(v) => updateNested('reactionXp', { enabled: v })}
              />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Awards</Label>
                <Select
                  value={leveling.reactionXp.awards}
                  onValueChange={(v) => updateNested('reactionXp', { awards: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both (send & receive)</SelectItem>
                    <SelectItem value="send">Sending reactions only</SelectItem>
                    <SelectItem value="receive">Receiving reactions only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumberInput
                label="Min"
                value={leveling.reactionXp.min}
                onChange={(v) => updateNested('reactionXp', { min: v })}
                min={1}
              />
              <NumberInput
                label="Max"
                value={leveling.reactionXp.max}
                onChange={(v) => updateNested('reactionXp', { max: v })}
                min={1}
              />
              <NumberInput
                label="Cooldown (seconds)"
                value={leveling.reactionXp.cooldownSeconds}
                onChange={(v) => updateNested('reactionXp', { cooldownSeconds: v })}
                min={5}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Level Up Message
            </CardTitle>
            <CardDescription>Customize the message sent when someone levels up.</CardDescription>
          </div>
          <Switch checked={leveling.levelUp.enabled} onCheckedChange={(v) => updateNested('levelUp', { enabled: v })} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-gray-300 space-y-1">
            <p>
              Tags: <code className="text-blue-300">{'{user.mention}'}</code>,{' '}
              <code className="text-blue-300">{'{user.name}'}</code>,{' '}
              <code className="text-blue-300">{'{user.level}'}</code>,{' '}
              <code className="text-blue-300">{'{user.xp}'}</code>,{' '}
              <code className="text-blue-300">{'{earned:You earned {mention}!}'}</code>
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={leveling.levelUp.channelMode}
                onValueChange={(v) => updateNested('levelUp', { channelMode: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message">Channel message was sent in</SelectItem>
                  <SelectItem value="specific">Specific channel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {leveling.levelUp.channelMode === 'specific' && (
              <div className="space-y-1.5">
                <Label>Level-up channel</Label>
                <ChannelSelect
                  channels={guild.channels}
                  value={leveling.levelUp.channelId}
                  onChange={(v) => updateNested('levelUp', { channelId: v })}
                />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Message template</Label>
            <Textarea
              rows={3}
              value={leveling.levelUp.template}
              onChange={(e) => updateNested('levelUp', { template: e.target.value })}
            />
          </div>
          <ToggleRow
            label="Include level-up image"
            description="Attach a rank card image when someone levels up."
            checked={leveling.levelUp.includeImage}
            onCheckedChange={(v) => updateNested('levelUp', { includeImage: v })}
          />
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label>Test in channel</Label>
              <ChannelSelect
                channels={guild.channels}
                value={testChannelId}
                onChange={setTestChannelId}
                allowNone={false}
              />
            </div>
            <Button type="button" variant="secondary" onClick={handleTestLevelUp} disabled={!testChannelId}>
              Test
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-4 w-4" /> Role Rewards
            </CardTitle>
            <CardDescription>Assign roles when members reach a level.</CardDescription>
          </div>
          <Badge variant="secondary">{leveling.levelRoles.length}/15 used</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Stack rewards"
            description="Keep all earned level roles instead of only the highest."
            checked={leveling.stackRewards}
            onCheckedChange={(v) => update({ stackRewards: v })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumberInput
              label="Level"
              value={parseInt(draftLevel, 10) || 1}
              onChange={(v) => setDraftLevel(String(v))}
              min={1}
              max={1000}
            />
            <div className="space-y-1.5">
              <Label>Role</Label>
              <RoleSelect roles={guild.roles} value={draftRoleId} onChange={setDraftRoleId} />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={addLevelRole} disabled={!draftRoleId || leveling.levelRoles.length >= 15}>
                Add reward
              </Button>
            </div>
          </div>
          {leveling.levelRoles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {leveling.levelRoles.map((lr: LevelRole) => (
                <Badge key={`${lr.level}-${lr.roleId}`} variant="secondary" className="gap-1 pr-1">
                  Lv {lr.level} → @{roleName(lr.roleId)}
                  <button
                    type="button"
                    className="ml-1 rounded hover:bg-muted p-0.5"
                    onClick={() =>
                      update({
                        levelRoles: leveling.levelRoles.filter(
                          (x) => !(x.level === lr.level && x.roleId === lr.roleId),
                        ),
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Separator />
          <div className="space-y-1.5 max-w-md">
            <Label>First place role</Label>
            <p className="text-xs text-gray-400">Given to the #1 ranked member (synced hourly).</p>
            <RoleSelect
              roles={guild.roles}
              value={leveling.firstPlaceRoleId}
              onChange={(v) => update({ firstPlaceRoleId: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Weekly & Monthly Highlights
          </CardTitle>
          <CardDescription>Post leaderboard recaps to a channel on schedule.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[hsl(var(--border))] p-4 space-y-3">
            <ToggleRow
              label="Weekly highlights"
              description="Top 10 by weekly XP — Sundays 00:00 UTC"
              checked={leveling.highlights.weeklyEnabled}
              onCheckedChange={(v) => updateNested('highlights', { weeklyEnabled: v })}
            />
            <ChannelSelect
              channels={guild.channels}
              value={leveling.highlights.weeklyChannelId}
              onChange={(v) => updateNested('highlights', { weeklyChannelId: v })}
            />
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] p-4 space-y-3">
            <ToggleRow
              label="Monthly highlights"
              description="Top 10 by monthly XP — 1st of each month"
              checked={leveling.highlights.monthlyEnabled}
              onCheckedChange={(v) => updateNested('highlights', { monthlyEnabled: v })}
            />
            <ChannelSelect
              channels={guild.channels}
              value={leveling.highlights.monthlyChannelId}
              onChange={(v) => updateNested('highlights', { monthlyChannelId: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rank Card</CardTitle>
          <CardDescription>Customize colors for !rank and optional level-up images.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black/20">
            {MOCK_MODE ? (
              <div
                className="w-full h-[200px] flex flex-col justify-center px-8 gap-3"
                style={{ backgroundColor: leveling.rankCard.backgroundColor, color: leveling.rankCard.fontColor }}
              >
                <p className="text-2xl font-bold underline">Preview User</p>
                <p className="text-sm opacity-90">Level: 5 · XP: 250 / 475 · Rank: 3</p>
                <div className="h-5 rounded-full bg-white/85 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: '52%', backgroundColor: leveling.rankCard.progressColor }}
                  />
                </div>
                <p className="text-xs text-gray-400">Mock preview — start the API for a live render.</p>
              </div>
            ) : (
              <img
                src={`/api/guilds/${guildId}/leveling/rank-card-preview?t=${previewKey}`}
                alt="Rank card preview"
                className="w-full max-h-[200px] object-cover"
              />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>Progress bar</Label>
              <Input
                type="color"
                value={leveling.rankCard.progressColor}
                onChange={(e) => updateNested('rankCard', { progressColor: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Background</Label>
              <Input
                type="color"
                value={leveling.rankCard.backgroundColor}
                onChange={(e) => updateNested('rankCard', { backgroundColor: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Font</Label>
              <Input
                type="color"
                value={leveling.rankCard.fontColor}
                onChange={(e) => updateNested('rankCard', { fontColor: e.target.value })}
              />
            </div>
            <NumberInput
              label="Opacity %"
              value={leveling.rankCard.opacity}
              onChange={(v) => updateNested('rankCard', { opacity: v })}
              min={0}
              max={100}
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => setPreviewKey((k) => k + 1)}>
            Refresh preview
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> XP Restrictions
          </CardTitle>
          <CardDescription>Control who and where members can earn XP.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>No XP channels</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    updateNested('restrictions', {
                      noXpChannelMode:
                        leveling.restrictions.noXpChannelMode === 'blacklist' ? 'whitelist' : 'blacklist',
                    })
                  }
                >
                  Mode: {leveling.restrictions.noXpChannelMode}
                </Button>
              </div>
              <p className="text-xs text-gray-400">
                {leveling.restrictions.noXpChannelMode === 'blacklist'
                  ? 'Members will not earn XP in selected channels.'
                  : 'Members only earn XP in selected channels.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {leveling.restrictions.noXpChannels.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    #{channelName(id)}
                    <button
                      type="button"
                      onClick={() =>
                        updateNested('restrictions', {
                          noXpChannels: leveling.restrictions.noXpChannels.filter((c) => c !== id),
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <ChannelSelect
                channels={guild.channels.filter((c) => !leveling.restrictions.noXpChannels.includes(c.id))}
                value={null}
                onChange={(v) => {
                  if (v) updateNested('restrictions', { noXpChannels: [...leveling.restrictions.noXpChannels, v] });
                }}
                placeholder="Add channel"
              />
            </div>
            <div className="space-y-3">
              <Label>No XP roles</Label>
              <p className="text-xs text-gray-400">Members with these roles will not gain XP.</p>
              <div className="flex flex-wrap gap-2">
                {leveling.restrictions.noXpRoles.map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    @{roleName(id)}
                    <button
                      type="button"
                      onClick={() =>
                        updateNested('restrictions', {
                          noXpRoles: leveling.restrictions.noXpRoles.filter((r) => r !== id),
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <RoleSelect
                roles={guild.roles.filter((r) => !leveling.restrictions.noXpRoles.includes(r.id))}
                value={null}
                onChange={(v) => {
                  if (v) updateNested('restrictions', { noXpRoles: [...leveling.restrictions.noXpRoles, v] });
                }}
                placeholder="Add role"
              />
            </div>
          </div>
          <ToggleRow
            label="Text in voice XP"
            description="Allow message XP in voice channels."
            checked={leveling.restrictions.textInVoiceXp}
            onCheckedChange={(v) => updateNested('restrictions', { textInVoiceXp: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Leaderboard
          </CardTitle>
          <CardDescription>Share a public web leaderboard for your server.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                Vanity URLs are first come, first served. Leave blank to use your server ID. Only letters, numbers, and
                hyphens (2–32 chars).
              </p>
              <div className="space-y-1.5">
                <Label>Vanity</Label>
                <p className="text-sm text-blue-400 break-all">{publicLeaderboardUrl}</p>
                <Input
                  value={leveling.leaderboardVanity ?? ''}
                  onChange={(e) => update({ leaderboardVanity: e.target.value || null })}
                  placeholder="my-server"
                  spellCheck={false}
                  autoCapitalize="none"
                />
              </div>
            </div>
            <div className="flex flex-col justify-end gap-3">
              <Button type="button" variant="secondary" asChild>
                <a href={publicLeaderboardUrl} target="_blank" rel="noreferrer">
                  View leaderboard <ExternalLink className="h-4 w-4 ml-2" />
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> XP Management
          </CardTitle>
          <CardDescription>Owner-only locks and destructive XP actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleRow
              label="Lock !rank to server owner"
              checked={leveling.management.rankCommandOwnerOnly}
              onCheckedChange={(v) => updateNested('management', { rankCommandOwnerOnly: v })}
            />
            <ToggleRow
              label="Lock XP reset to server owner"
              checked={leveling.management.resetOwnerOnly}
              onCheckedChange={(v) => updateNested('management', { resetOwnerOnly: v })}
            />
            <ToggleRow
              label="Reset XP when member leaves"
              description="Clears their level profile when they leave the server."
              checked={leveling.management.resetOnLeave}
              onCheckedChange={(v) => updateNested('management', { resetOnLeave: v })}
            />
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={handleResetXp}>
              Reset all server XP
            </Button>
          </div>
          {leaderboard.length > 0 && (
            <div className="rounded-lg border border-[hsl(var(--border))] p-3 text-sm space-y-1">
              <p className="font-medium text-white mb-2">Current leaderboard</p>
              {leaderboard.map((row, i) => (
                <p key={row.userId} className="text-gray-300">
                  {i + 1}. <span className="font-mono text-xs">{row.userId}</span> — lv {row.level} ({row.xp} xp)
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" /> Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
