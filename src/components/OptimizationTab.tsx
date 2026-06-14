'use client';

import React from 'react';
import { Search, Download, Sparkles, Filter, ChevronRight, X, MessageSquare, Clipboard, Eye, Play, ShieldAlert, LineChart as ChartIcon } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatVND, formatPercent, formatNumber, formatDate, formatVNDFull } from '@/lib/metrics';

interface OptimizationTabProps {
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

type TabLevel = 'campaign' | 'adset' | 'ad';

export default function OptimizationTab({ filters, triggerRefresh }: OptimizationTabProps) {
  const [level, setLevel] = React.useState<TabLevel>('campaign');
  const [data, setData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  
  // Local filters
  const [search, setSearch] = React.useState('');
  const [selectedRecType, setSelectedRecType] = React.useState('');
  const [selectedFunnel, setSelectedFunnel] = React.useState('');
  
  // Drawer state
  const [selectedItem, setSelectedItem] = React.useState<any | null>(null);
  const [notes, setNotes] = React.useState('');
  const [savingNotes, setSavingNotes] = React.useState(false);

  React.useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams({
          level,
          accountId: filters.accountId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          campus: filters.campus,
          grade: filters.grade,
          funnel: selectedFunnel,
          recommendationType: selectedRecType,
        });

        const res = await fetch(`/api/dashboard/ads-optimization?${queryParams.toString()}`);
        const result = await res.json();
        
        if (result.error) {
          setError(result.error);
        } else {
          setData(result.data || []);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch optimization data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [level, filters, selectedRecType, selectedFunnel, triggerRefresh]);

  const handleOpenDrawer = (item: any) => {
    setSelectedItem(item);
    setNotes(item.contentMapping?.note || '');
  };

  const handleSaveNotes = async () => {
    if (!selectedItem) return;
    setSavingNotes(true);
    try {
      // Find adId to map content mapping
      let adId = selectedItem.id;
      if (level !== 'ad') {
        // Fallback for campaign/adset level, find matching ad or create dummy association
        // In real app, contentMapping targets ad level
      }

      const res = await fetch('/api/content-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId,
          note: notes,
        }),
      });

      const result = await res.json();
      if (result.success) {
        // Update local item notes state
        setSelectedItem((prev: any) => ({
          ...prev,
          contentMapping: {
            ...(prev?.contentMapping || {}),
            note: notes,
          }
        }));
        // Update list item
        setData(prevData => prevData.map(d => d.id === selectedItem.id ? {
          ...d,
          contentMapping: { ...(d.contentMapping || {}), note: notes }
        } : d));
        alert('Lưu ghi chú thành công!');
      } else {
        alert(result.error || 'Failed to save notes');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  const getRecommendationBadge = (rec: string) => {
    switch (rec) {
      case 'SCALE': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'HOLD': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
      case 'TEST': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      case 'REVIEW': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'CUT': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'REFRESH_CREATIVE': return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
      case 'CHECK_LEAD_QUALITY': return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'CHECK_SALES': return 'bg-pink-500/10 text-pink-400 border-pink-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getSeverityColor = (sev: string) => {
    if (sev === 'high') return 'text-rose-400';
    if (sev === 'medium') return 'text-amber-400';
    return 'text-slate-400';
  };

  // Filter list by search key
  const filteredData = data.filter(item => 
    item.name.toLowerCase().includes(search.toLowerCase()) || 
    item.id.toLowerCase().includes(search.toLowerCase())
  );

  const handleExportCSV = () => {
    if (filteredData.length === 0) return;
    const headers = ['ID', 'Name', 'Spend', 'Budget', 'Leads', 'CPL', 'QL', 'CTR%', 'CPC', 'CPM', 'Frequency', 'Recommendation'];
    const rows = filteredData.map(item => [
      item.id,
      item.name,
      item.spend,
      item.budget,
      item.leads,
      item.cpl || 'N/A',
      item.ql,
      item.ctr.toFixed(2),
      item.cpc.toFixed(0),
      item.cpm.toFixed(0),
      item.frequency.toFixed(2),
      item.recommendation,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ads_optimization_${level}_${filters.dateFrom}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Local Navigation Tabs */}
      <div className="flex justify-between items-center bg-slate-900/40 p-1.5 rounded-2xl border border-slate-800/80">
        <div className="flex space-x-1">
          {(['campaign', 'adset', 'ad'] as TabLevel[]).map(lvl => (
            <button
              key={lvl}
              onClick={() => { setLevel(lvl); setSelectedItem(null); }}
              className={`px-4 py-2 text-xs font-extrabold rounded-xl capitalize transition-all ${level === lvl ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {lvl === 'campaign' ? 'Campaigns' : lvl === 'adset' ? 'Ad Sets' : 'Ads'}
            </button>
          ))}
        </div>
        <button 
          onClick={handleExportCSV}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 text-xs font-bold transition-all"
        >
          <Download className="w-3.5 h-3.5" /> <span>Xuất CSV</span>
        </button>
      </div>

      {/* Advanced Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900/20 p-4 rounded-2xl border border-slate-850">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Tìm theo tên hoặc ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder-slate-500"
          />
        </div>

        <div>
          <select
            value={selectedRecType}
            onChange={(e) => setSelectedRecType(e.target.value)}
            className="w-full px-4 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">-- Khuyến nghị tối ưu --</option>
            <option value="SCALE">SCALE (Nhân rộng)</option>
            <option value="CUT">CUT (Tắt quảng cáo)</option>
            <option value="HOLD">HOLD (Giữ nguyên)</option>
            <option value="REVIEW">REVIEW (Tối ưu hóa)</option>
            <option value="REFRESH_CREATIVE">REFRESH CREATIVE (Làm mới)</option>
            <option value="CHECK_LEAD_QUALITY">CHECK QUALITY (Chất lượng)</option>
            <option value="CHECK_SALES">CHECK SALES (Kiểm tra tư vấn)</option>
          </select>
        </div>

        {level === 'ad' && (
          <div>
            <select
              value={selectedFunnel}
              onChange={(e) => setSelectedFunnel(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-950/40 border border-slate-850 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">-- Giai đoạn Phễu --</option>
              <option value="TOFU">TOFU (Nhận diện)</option>
              <option value="MOFU">MOFU (Cân nhắc)</option>
              <option value="BOFU">BOFU (Chuyển đổi)</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="h-64 bg-slate-900/20 border border-slate-800 rounded-3xl animate-pulse flex items-center justify-center text-slate-500 text-xs">
          Đang tải dữ liệu và phân tích chỉ số...
        </div>
      ) : error ? (
        <div className="bg-red-950/20 border border-red-500/50 text-red-200 p-6 rounded-2xl flex items-center space-x-3 text-xs">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
          <span>Lỗi tải danh sách: {error}</span>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/20 border-2 border-dashed border-slate-850 rounded-3xl text-slate-500 text-xs">
          Không tìm thấy chiến dịch/ad nào phù hợp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="text-3xs text-slate-500 uppercase tracking-wider bg-slate-950/20 border-b border-slate-800/60">
                <tr>
                  <th className="py-4.5 px-6 font-semibold">Khuyến nghị</th>
                  <th className="py-4.5 px-6 font-semibold">Tên đối tượng</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Chi tiêu</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Ngân sách</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Leads</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CPL</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CTR</th>
                  <th className="py-4.5 px-6 font-semibold text-right">CPM</th>
                  <th className="py-4.5 px-6 font-semibold text-right">Tần suất</th>
                  <th className="py-4.5 px-6 font-semibold text-center">Xu hướng (3d)</th>
                  <th className="py-4.5 px-6 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-slate-300">
                {filteredData.map((item) => (
                  <tr 
                    key={item.id} 
                    onClick={() => handleOpenDrawer(item)}
                    className="hover:bg-slate-800/20 cursor-pointer transition-colors group"
                  >
                    <td className="py-4 px-6">
                      <span className={`inline-block px-2.5 py-0.5 text-3xs font-extrabold rounded-full border ${getRecommendationBadge(item.recommendation)}`}>
                        {item.recommendation}
                      </span>
                    </td>
                    <td className="py-4 px-6 max-w-xs truncate">
                      <span className="font-bold text-slate-200 block truncate" title={item.name}>{item.name}</span>
                      <span className="text-3xs text-slate-500 font-mono block pt-0.5">ID: {item.id}</span>
                    </td>
                    <td className="py-4 px-6 text-right font-medium text-slate-100">{formatVND(item.spend)}</td>
                    <td className="py-4 px-6 text-right text-slate-400">{formatVND(item.budget)}</td>
                    <td className="py-4 px-6 text-right font-bold text-slate-200">{item.leads}</td>
                    <td className="py-4 px-6 text-right text-indigo-400 font-extrabold">{formatVND(item.cpl)}</td>
                    <td className="py-4 px-6 text-right">{formatPercent(item.ctr)}</td>
                    <td className="py-4 px-6 text-right text-slate-500">{formatVND(item.cpm)}</td>
                    <td className="py-4 px-6 text-right">{item.frequency.toFixed(2)}</td>
                    <td className="py-4 px-6 text-center">
                      <span className={`font-bold ${item.trend3Days > 10 ? 'text-rose-400' : item.trend3Days < -10 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {item.trend3Days > 0 ? `+${item.trend3Days.toFixed(0)}%` : `${item.trend3Days.toFixed(0)}%`}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-350 transition-colors inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DETAIL SLIDE-OUT DRAWER */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop overlay */}
          <div 
            onClick={() => setSelectedItem(null)} 
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity" 
          />

          {/* Panel */}
          <div className="relative w-full max-w-xl h-full bg-slate-900 border-l border-slate-800/80 shadow-2xl p-6 flex flex-col justify-between z-10 animate-slide-in overflow-y-auto space-y-6">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b border-slate-850 pb-4">
              <div className="space-y-1 max-w-[85%]">
                <span className="text-3xs text-slate-500 font-bold uppercase tracking-wider">{level} Detail Information</span>
                <h3 className="font-extrabold text-md text-slate-100 break-words leading-tight">{selectedItem.name}</h3>
                <span className="text-3xs font-mono text-slate-500 block">ID: {selectedItem.id}</span>
              </div>
              <button 
                onClick={() => setSelectedItem(null)}
                className="p-1.5 bg-slate-950/40 border border-slate-800 hover:bg-slate-800 text-slate-400 rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 space-y-6 overflow-y-auto">
              
              {/* Recommendation Evidence alert */}
              <div className="bg-slate-950/40 p-4.5 rounded-2xl border border-slate-850 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-black text-slate-200">Đề xuất tối ưu đề xuất</span>
                  </div>
                  <span className={`px-2 py-0.5 text-3xs font-extrabold rounded-full border ${getRecommendationBadge(selectedItem.recommendation)}`}>
                    {selectedItem.recommendation}
                  </span>
                </div>
                <p className="text-xs text-slate-350 leading-relaxed">{selectedItem.recommendationReason}</p>
              </div>

              {/* Trend Chart placeholder or mini charts */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs text-slate-300 flex items-center">
                  <ChartIcon className="w-4 h-4 text-indigo-400 mr-2" /> Hiệu suất chi tiết
                </h4>
                <div className="grid grid-cols-3 gap-4 text-center text-xs">
                  <div className="bg-slate-950/30 p-3 rounded-xl border border-slate-850">
                    <span className="text-slate-500 text-3xs block">CHI TIÊU</span>
                    <span className="font-extrabold text-slate-300 block pt-1">{formatVND(selectedItem.spend)}</span>
                  </div>
                  <div className="bg-slate-950/30 p-3 rounded-xl border border-slate-850">
                    <span className="text-slate-500 text-3xs block">LEADS</span>
                    <span className="font-extrabold text-slate-300 block pt-1">{selectedItem.leads}</span>
                  </div>
                  <div className="bg-slate-950/30 p-3 rounded-xl border border-slate-850">
                    <span className="text-slate-500 text-3xs block">CPL</span>
                    <span className="font-extrabold text-indigo-400 block pt-1">{formatVND(selectedItem.cpl)}</span>
                  </div>
                </div>
              </div>

              {/* Creative Previews (For Ad level only) */}
              {level === 'ad' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-xs text-slate-300 flex items-center">
                    <Eye className="w-4 h-4 text-indigo-400 mr-2" /> Mẫu thiết kế quảng cáo (Creative Preview)
                  </h4>
                  <div className="bg-slate-950/40 border border-slate-850 rounded-2xl overflow-hidden p-4 flex gap-4 items-start">
                    <div className="w-24 h-24 bg-slate-800 rounded-lg shrink-0 flex items-center justify-center overflow-hidden border border-slate-700">
                      {selectedItem.contentMapping?.format === 'VIDEO' ? (
                        <div className="relative w-full h-full flex items-center justify-center bg-slate-900">
                          <Play className="w-6 h-6 text-white opacity-60 absolute" />
                          <span className="text-4xs text-slate-500 absolute bottom-1">VIDEO MOCK</span>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-slate-950 flex items-center justify-center text-slate-600 text-3xs">
                          MOCK IMAGE
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-xs flex-1">
                      <span className="font-bold text-slate-200 block">Tuyển sinh hệ chuẩn quốc tế</span>
                      <p className="text-slate-400 text-3xs leading-relaxed line-clamp-3">
                        Học tập tại Dewey School giúp con phát triển toàn diện, tự tin hòa nhập toàn cầu. Đăng ký tham quan campus nhận ưu đãi đặc biệt ngay hôm nay!
                      </p>
                      <span className="text-4xs text-indigo-400 block font-bold font-mono">Link: dewey.edu.vn/admissions</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Content Mapping Section */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs text-slate-300 flex items-center">
                  <Clipboard className="w-4 h-4 text-indigo-400 mr-2" /> Content Mapping Tags
                </h4>
                {selectedItem.contentMapping ? (
                  <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/20 p-4 rounded-xl border border-slate-850/60">
                    <div><span className="text-slate-500 text-3xs">Content ID:</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.contentId || 'N/A'}</span></div>
                    <div><span className="text-slate-500 text-3xs">Phân khúc phễu:</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.funnelStage || 'N/A'}</span></div>
                    <div><span className="text-slate-500 text-3xs">Campus:</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.campus || 'N/A'}</span></div>
                    <div><span className="text-slate-500 text-3xs">Khối học:</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.grade || 'N/A'}</span></div>
                    <div><span className="text-slate-500 text-3xs">Content Angle:</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.angle || 'N/A'}</span></div>
                    <div><span className="text-slate-500 text-3xs">Định dạng (Format):</span> <span className="font-semibold text-slate-300">{selectedItem.contentMapping.format || 'N/A'}</span></div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Mẫu này chưa được Mapping. Hãy gắn nhãn định danh tại trang Content Mapping.</p>
                )}
              </div>

              {/* Notes input */}
              <div className="space-y-3 border-t border-slate-850 pt-4">
                <h4 className="font-bold text-xs text-slate-300 flex items-center">
                  <MessageSquare className="w-4 h-4 text-indigo-400 mr-2" /> Ghi chú của Specialist
                </h4>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ghi chú về mẫu quảng cáo này (ví dụ: cần test tiếp hook, CPL đắt do tệp hẹp...)"
                  className="w-full h-24 p-3 bg-slate-950/40 border border-slate-850 rounded-xl text-xs text-slate-200 placeholder-slate-650 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

            </div>

            {/* Footer actions */}
            <div className="border-t border-slate-850 pt-4 flex justify-end space-x-3 bg-slate-900 sticky bottom-0">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 text-xs font-bold bg-slate-800 text-slate-300 rounded-xl hover:bg-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes || level !== 'ad'}
                className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                title={level !== 'ad' ? 'Chỉ hỗ trợ ghi chú ở level Ad' : 'Lưu lại ghi chú'}
              >
                {savingNotes ? 'Đang lưu...' : 'Lưu ghi chú'}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
