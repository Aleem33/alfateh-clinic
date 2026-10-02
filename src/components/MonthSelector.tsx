export function MonthSelector({ value, onChange, label = 'Month' }: {
  value: string;
  onChange: (month: string) => void;
  label?: string;
}) {
  return <div className="flex items-center gap-2 flex-wrap">
    <label className="flex items-center gap-2 text-sm text-gray-600">
      {label}
      <input type="month" value={value} onChange={event => onChange(event.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </label>
    {value && <button type="button" onClick={() => onChange('')} className="text-xs text-blue-600 hover:underline">Clear month</button>}
  </div>;
}
