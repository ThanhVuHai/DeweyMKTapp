'use client';

import React from 'react';
import { Layers, HelpCircle, ShieldAlert, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { formatPercent, formatNumber } from '@/lib/metrics';

interface FunnelTabProps {
  filters: {
    accountId: string;
    dateFrom: string;
    dateTo: string;
    campus: string;
    grade: string;
    source: string;
  };
  triggerRefresh: number;
}

export default function FunnelTab({ filters, triggerRefresh }: FunnelTabProps) {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({
          accountId: filters.accountId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          campus: filters.campus,
          grade: filters.grade,
          source: filters.source,
        });

        const res = await fetch(`/api/dashboard/funnel?${queryParams.toString()}`);
        const result = await res.json();
        
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch funnel data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, triggerRefresh]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-64 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
        <div className="h-64 bg-slate-800/50 rounded-2xl border border-slate-700/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3">
        <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
        <span>Lỗi tải phân tích phễu: {error}</span>
      </div>
    );
  }

  const { funnelStages, diagnostics } = data;

  return (
    <div className="space-y-8">
      {/* Funnel Graph Visualizer */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-6">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Layers className="w-5 h-5 text-indigo-400 mr-2" /> Trực quan hóa phễu chuyển đổi (Funnel Conversion)
          </h3>
          <p className="text-xs text-slate-500">Mô phỏng tỷ lệ rơi rụng khách hàng qua từng giai đoạn từ tiếp cận đến nhập học</p>
        </div>

        {/* CSS horizontal funnel bar stack */}
        <div className="space-y-4 pt-4">
          {funnelStages.map((stage: any, idx: number) => {
            // Calculate width scaling based on the first stage (Impressions) which is 100%
            const maxVal = funnelStages[0].value || 1;
            const widthPct = Math.max(12, (stage.value / maxVal) * 100);

            // Colored theme per stage
            const getStageBg = (index: number) => {
              if (index < 3) return 'bg-gradient-to-r from-indigo-600 to-indigo-500'; // TOFU
              if (index < 5) return 'bg-gradient-to-r from-teal-600 to-teal-500';     // MOFU
              return 'bg-gradient-to-r from-emerald-600 to-emerald-500';            // BOFU
            };

            return (
              <div key={idx} className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-300">{stage.name}</span>
                  <div className="space-x-3">
                    <span className="text-slate-400 font-medium">{formatNumber(stage.value)}</span>
                    {idx > 0 && (
                      <span className="text-3xs text-emerald-400 font-black px-1.5 py-0.5 rounded-md bg-emerald-500/10">
                        {idx === 1 ? `CTR: ${formatPercent(stage.rate)}` : idx === 2 ? `LPV Rate: ${formatPercent(stage.rate)}` : idx === 3 ? `Click→Lead: ${formatPercent(stage.rate)}` : `CVR: ${formatPercent(stage.rate)}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-5 w-full bg-slate-950/40 border border-slate-850 rounded-lg overflow-hidden flex items-center">
                  <div 
                    className={`h-full ${getStageBg(idx)} rounded-r-md transition-all duration-1000 shadow-md`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Troubleshooting Diagnostics Section */}
      <div className="bg-slate-900/60 border border-slate-800/80 p-6 rounded-3xl shadow-xl space-y-6">
        <div>
          <h3 className="font-extrabold text-lg text-slate-200 flex items-center">
            <Info className="w-5 h-5 text-indigo-400 mr-2" /> Chẩn đoán & Giải quyết vấn đề (Troubleshooting Diagnostics)
          </h3>
          <p className="text-xs text-slate-500">Phân tích tỷ lệ rơi rụng để phát hiện nút thắt cổ chai của phễu</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {diagnostics.map((diag: any, idx: number) => {
            const isWarning = diag.status === 'warning';
            const isError = diag.status === 'error';
            const isSuccess = diag.status === 'success';

            return (
              <div 
                key={idx} 
                className={`p-5 rounded-2xl border transition-all ${isError ? 'bg-rose-950/10 border-rose-500/20' : isWarning ? 'bg-amber-950/10 border-amber-500/20' : 'bg-emerald-950/10 border-emerald-500/20'}`}
              >
                <div className="flex items-center space-x-2.5 mb-2.5">
                  {isError ? (
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                  ) : isWarning ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  ) : (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  )}
                  <h4 className="font-bold text-xs text-slate-200">{diag.stage}</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">{diag.message}</p>
                <div className="flex space-x-6 text-3xs text-slate-500 font-semibold border-t border-slate-800/40 pt-2.5">
                  <span>Chỉ số: <span className={isError ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-emerald-400'}>{diag.metric}</span></span>
                  <span>Benchmark tiêu chuẩn: <span>{diag.benchmark}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
