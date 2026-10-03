import React from 'react';
import { Search, X } from 'lucide-react';

export interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  filters?: {
    id: string;
    label: string;
    count?: number;
    active: boolean;
    onClick: () => void;
  }[];
  actions?: React.ReactNode;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Buscar...',
  filters,
  actions,
}) => {
  return (
    <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between pb-4">
      {/* Search Input */}
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-10 pr-9 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all shadow-xs"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            aria-label="Limpiar búsqueda"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filter Pills and Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {filters && (
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={f.onClick}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                  f.active
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>{f.label}</span>
                {f.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      f.active ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {actions && <div className="flex items-center gap-2 ml-auto">{actions}</div>}
      </div>
    </div>
  );
};
