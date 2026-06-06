import {
  usagePageRanges,
  usageRanges,
  type UsagePageRange,
  type UsageRange,
} from '@/features/usage/ranges'

export function UsageRangeControl({
  value,
  onChange,
}: {
  value: UsageRange
  onChange: (value: UsageRange) => void
}) {
  return (
    <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
      {usageRanges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`h-6 rounded-md px-2 text-[11px] font-medium transition ${
            value === range.value
              ? 'bg-white/14 text-white shadow-sm'
              : 'text-white/45 hover:text-white/75'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}

export function UsagePageRangeControl({
  value,
  onChange,
}: {
  value: UsagePageRange
  onChange: (value: UsagePageRange) => void
}) {
  return (
    <div className="range-control flex items-center rounded-lg border border-white/10 bg-white/[0.035] p-0.5">
      {usagePageRanges.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium transition ${
            value === range.value
              ? 'bg-white/14 text-white shadow-sm'
              : 'text-white/45 hover:text-white/75'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  )
}
