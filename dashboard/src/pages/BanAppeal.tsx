import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router';

interface AppealSummary {
  guildName: string;
  banReason: string;
  caseNumber: number | null;
  eligible: boolean;
  state: 'none' | 'pending' | 'approved' | 'denied' | 'dismissed' | 'blacklisted';
  nextEligibleAt: string | null;
}

interface AppealForm {
  whatHappened: string;
  whyLift: string;
  whatDifferent: string;
  evidence: string;
  onlyFluxerAccount: '' | 'yes' | 'no';
}

const emptyForm: AppealForm = {
  whatHappened: '',
  whyLift: '',
  whatDifferent: '',
  evidence: '',
  onlyFluxerAccount: '',
};

export function BanAppeal() {
  const { token } = useParams();
  const [summary, setSummary] = useState<AppealSummary | null>(null);
  const [form, setForm] = useState<AppealForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/appeal/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = (await response.json()) as AppealSummary & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Could not load this appeal.');
        setSummary(body);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load this appeal.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/appeal/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, onlyFluxerAccount: form.onlyFluxerAccount || null }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not submit this appeal.');
      setSubmitted(true);
      setSummary((current) => (current ? { ...current, state: 'pending' } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Could not submit this appeal.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] text-gray-300">
        Loading…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[hsl(var(--background))] px-6 py-12 text-gray-300">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Ban appeal</h1>
          {summary && <p className="mt-2 text-gray-400">This appeal is for a ban from {summary.guildName}.</p>}
        </div>

        {error && <div className="rounded-lg border border-red-900 bg-red-950/40 p-4 text-red-200">{error}</div>}

        {!summary ? null : !summary.eligible ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <p>This ban is not eligible for an appeal.</p>
          </section>
        ) : submitted || summary.state === 'pending' ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <h2 className="font-medium text-white">Appeal submitted</h2>
            <p className="mt-2 text-gray-400">
              Staff will review your answers. You do not need to submit another appeal.
            </p>
          </section>
        ) : summary.state === 'blacklisted' ? (
          <section className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <p>Further appeals are not available for this ban.</p>
          </section>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="rounded-md bg-black/20 p-4 text-sm">
              <p className="text-gray-400">Ban reason</p>
              <p className="mt-1 text-white">{summary.banReason || 'No reason provided'}</p>
              {summary.caseNumber && <p className="mt-2 text-gray-500">Case #{summary.caseNumber}</p>}
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">What happened from your side?</span>
              <textarea
                required
                maxLength={1000}
                value={form.whatHappened}
                onChange={(event) => setForm({ ...form, whatHappened: event.target.value })}
                className="min-h-28 w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">Why should the ban be lifted?</span>
              <textarea
                required
                maxLength={1000}
                value={form.whyLift}
                onChange={(event) => setForm({ ...form, whyLift: event.target.value })}
                className="min-h-28 w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">What will you do differently?</span>
              <textarea
                required
                maxLength={1000}
                value={form.whatDifferent}
                onChange={(event) => setForm({ ...form, whatDifferent: event.target.value })}
                className="min-h-28 w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-blue-500"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">Evidence (links only, optional)</span>
              <textarea
                maxLength={1000}
                value={form.evidence}
                onChange={(event) => setForm({ ...form, evidence: event.target.value })}
                className="min-h-20 w-full rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-blue-500"
                placeholder="https://example.com/evidence"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-white">Is this your only Fluxer account? (optional)</span>
              <select
                value={form.onlyFluxerAccount}
                onChange={(event) =>
                  setForm({ ...form, onlyFluxerAccount: event.target.value as AppealForm['onlyFluxerAccount'] })
                }
                className="rounded-md border border-white/10 bg-black/20 p-3 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Choose one</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit appeal'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
