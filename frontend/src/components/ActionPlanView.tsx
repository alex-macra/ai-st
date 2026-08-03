import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Search,
  BookOpen,
  FlaskConical,
} from 'lucide-react';
import type {
  ActionPlan,
  ActionPlanItem,
  ArtifactCaveat,
  EvidenceReference,
  Finding,
} from '../shared/types';
import { stripInlineCitations } from '../utils';

interface Props {
  plan: ActionPlan;
  findings: Finding[];
}

function FindingBadge({ id, findings }: { id: string; findings: Finding[] }) {
  const f = findings.find((x) => x.id === id);
  const short = id.slice(0, 10);
  const tip = f ? f.claim : id;
  return (
    <span
      title={tip}
      className="inline-block text-xs font-mono bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded px-1.5 py-0.5 mr-1 cursor-default"
    >
      {short}…
    </span>
  );
}

function Section({
  title,
  icon,
  accent,
  defaultOpen,
  children,
  count,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  defaultOpen: boolean;
  children: React.ReactNode;
  count: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-lg border ${accent} bg-white dark:bg-slate-800 shadow-sm`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <span className="shrink-0">{icon}</span>
        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 flex-1">
          {title}
        </span>
        <span className="text-xs text-slate-400 mr-2">
          {count} item{count !== 1 ? 's' : ''}
        </span>
        {open ? (
          <ChevronUp size={14} className="text-slate-400" />
        ) : (
          <ChevronDown size={14} className="text-slate-400" />
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

function ActionItem({
  item,
  index,
  findings,
}: {
  item: ActionPlanItem;
  index: number;
  findings: Finding[];
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold flex items-center justify-center">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {stripInlineCitations(item.action)}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {stripInlineCitations(item.rationale)}
        </p>
        {item.findingIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-0.5">
            {item.findingIds.map((id) => (
              <FindingBadge key={id} id={id} findings={findings} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactItem({ item, findings }: { item: ArtifactCaveat; findings: Finding[] }) {
  const f = findings.find((x) => x.id === item.findingId);
  return (
    <div className="flex gap-3">
      <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-500" />
      <div className="flex-1 min-w-0">
        {f && (
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate mb-0.5">
            {f.claim}
          </p>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {stripInlineCitations(item.concern)}
        </p>
        <FindingBadge id={item.findingId} findings={findings} />
      </div>
    </div>
  );
}

export function ActionPlanView({ plan, findings }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Generated {new Date(plan.generatedAt).toLocaleString()} · {plan.modelVersion} · prompt{' '}
          {plan.promptVersion}
        </p>
      </div>

      <Section
        title="Priority Actions"
        icon={<CheckCircle2 size={15} className="text-emerald-500" />}
        accent="border-emerald-200 dark:border-emerald-800"
        defaultOpen={true}
        count={plan.priorityActions.length}
      >
        {plan.priorityActions.length === 0 ? (
          <p className="text-xs text-slate-400">
            No high-confidence findings to anchor priority actions.
          </p>
        ) : (
          plan.priorityActions.map((item, i) => (
            <ActionItem key={i} item={item} index={i} findings={findings} />
          ))
        )}
      </Section>

      <Section
        title="Verify Next"
        icon={<Search size={15} className="text-amber-500" />}
        accent="border-amber-200 dark:border-amber-800"
        defaultOpen={true}
        count={plan.verifyNext.length}
      >
        {plan.verifyNext.length === 0 ? (
          <p className="text-xs text-slate-400">No items flagged for verification.</p>
        ) : (
          plan.verifyNext.map((item, i) => (
            <ActionItem key={i} item={item} index={i} findings={findings} />
          ))
        )}
      </Section>

      {plan.artifactCaveats.length > 0 && (
        <Section
          title="Artefact Caveats"
          icon={<AlertTriangle size={15} className="text-amber-500" />}
          accent="border-amber-200 dark:border-amber-800"
          defaultOpen={false}
          count={plan.artifactCaveats.length}
        >
          {plan.artifactCaveats.map((item, i) => (
            <ArtifactItem key={i} item={item} findings={findings} />
          ))}
        </Section>
      )}

      <Section
        title="Clinical Context"
        icon={<BookOpen size={15} className="text-blue-500" />}
        accent="border-blue-200 dark:border-blue-800"
        defaultOpen={false}
        count={1 + plan.clinicalContext.rareButRelevant.length}
      >
        <div>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Common presentation
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            {stripInlineCitations(plan.clinicalContext.commonPresentation)}
          </p>
        </div>
        {plan.clinicalContext.treatmentEvidence && (
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Treatment evidence
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              {stripInlineCitations(plan.clinicalContext.treatmentEvidence)}
            </p>
          </div>
        )}
        {plan.clinicalContext.rareButRelevant.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Rare but relevant
            </p>
            <ul className="space-y-1.5">
              {plan.clinicalContext.rareButRelevant.map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span className="shrink-0 text-blue-400">·</span>
                  {stripInlineCitations(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {plan.evidenceReferences && plan.evidenceReferences.length > 0 && (
        <Section
          title="Evidence References"
          icon={<FlaskConical size={15} className="text-violet-500" />}
          accent="border-violet-200 dark:border-violet-800"
          defaultOpen={false}
          count={plan.evidenceReferences.length}
        >
          <EvidenceTable refs={plan.evidenceReferences} />
        </Section>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500 italic pt-1">
        AI-generated draft for clinician review. This is not a diagnosis. Every review task requires
        clinical judgement.
      </p>
    </div>
  );
}

function EvidenceTable({ refs }: { refs: EvidenceReference[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-1 pr-3 font-medium text-slate-500 dark:text-slate-400 w-6">
              #
            </th>
            <th className="text-left py-1 pr-3 font-medium text-slate-500 dark:text-slate-400">
              Study / Guideline
            </th>
            <th className="text-left py-1 pr-3 font-medium text-slate-500 dark:text-slate-400 w-16">
              Year
            </th>
            <th className="text-left py-1 pr-3 font-medium text-slate-500 dark:text-slate-400 w-20">
              Source
            </th>
            <th className="text-left py-1 font-medium text-slate-500 dark:text-slate-400">
              Relevance
            </th>
          </tr>
        </thead>
        <tbody>
          {refs.map((ref, i) => (
            <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-1 pr-3 font-mono text-slate-400">{i + 1}</td>
              <td className="py-1 pr-3 font-medium text-slate-700 dark:text-slate-200">
                {ref.name}
              </td>
              <td className="py-1 pr-3 font-mono text-slate-500 dark:text-slate-400">{ref.year}</td>
              <td className="py-1 pr-3 text-slate-500 dark:text-slate-400">{ref.source}</td>
              <td className="py-1 text-slate-600 dark:text-slate-300">{ref.relevance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
