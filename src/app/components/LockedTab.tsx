'use client';

import Link from 'next/link';
import { type PlanTier, PLAN_METADATA } from '@/lib/plans';
import PlanBadge from '@/app/components/PlanBadge';

interface LockedTabProps {
  requiredPlan: PlanTier;
  currentPlan: PlanTier;
  tabName: string;
}

export default function LockedTab({ requiredPlan, currentPlan, tabName }: LockedTabProps) {
  const meta = PLAN_METADATA[requiredPlan];
  const icons: Record<PlanTier, string> = {
    free: '🔓',
    pro: '⚡',
    elite: '💎',
    gold: '👑',
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-6 py-16">
      <div className="text-6xl mb-6">{icons[requiredPlan]}</div>
      <h2 className="text-2xl font-bold text-white mb-4">
        {tabName} — requiere plan <PlanBadge plan={requiredPlan} size="md" />
      </h2>
      <p className="text-gray-400 mb-2 max-w-md">
        Tu plan actual es <PlanBadge plan={currentPlan} size="sm" />.
        {' '}Actualiza a <PlanBadge plan={requiredPlan} size="sm" /> para acceder a esta sección.
      </p>
      <p className="text-gray-500 text-sm mb-8 max-w-sm mt-3">
        {requiredPlan === 'elite'
          ? 'El plan Elite incluye Diario del Inversor, Resumen Maestro y descarga de análisis en PDF.'
          : requiredPlan === 'gold'
          ? 'El plan Gold incluye acceso a Early Beta, Resumen mensual del mercado y soporte VIP.'
          : 'El plan Pro incluye acceso completo a todas las pestañas de análisis.'}
      </p>
      <Link
        href="/pricing"
        className={`px-8 py-3 rounded-xl font-bold text-white transition-all shadow-lg ${
          requiredPlan === 'gold'
            ? 'bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400'
            : requiredPlan === 'elite'
            ? 'bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400'
            : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400'
        }`}
      >
        Ver planes — desde ${PLAN_METADATA[requiredPlan].price}/mes
      </Link>
    </div>
  );
}

/** Wraps a sub-tab inside a Group component with a lock overlay */
export function LockedSubTab({ requiredPlan, currentPlan }: { requiredPlan: PlanTier; currentPlan: PlanTier }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] text-center px-6 py-12">
      <div className="text-4xl mb-4">🔒</div>
      <p className="text-gray-300 font-semibold mb-3">
        Requiere plan <PlanBadge plan={requiredPlan} size="md" />
      </p>
      <p className="text-gray-500 text-sm mb-6">
        Tu plan actual <PlanBadge plan={currentPlan} size="sm" /> no incluye esta sección.
      </p>
      <Link href="/pricing" className="px-6 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold transition">
        Actualizar plan
      </Link>
    </div>
  );
}
