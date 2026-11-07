'use client';

import React from 'react';
import { 
  LayoutDashboard, Target, Activity, BarChart2, Layers, ShieldAlert, 
  Settings, FolderKanban, Users, ClipboardList, RefreshCw, Sparkles,
  ChevronLeft, ChevronRight, UserCheck, Calendar
} from 'lucide-react';

// Tabs imports
import OverviewTab from '@/components/OverviewTab';
import ExecutiveTab from '@/components/ExecutiveTab';
import OptimizationTab from '@/components/OptimizationTab';
import ContentTab from '@/components/ContentTab';
import FunnelTab from '@/components/FunnelTab';
import KpiTab from '@/components/KpiTab';
import MappingTab from '@/components/MappingTab';
import ConnectionTab from '@/components/ConnectionTab';
import AuditTab from '@/components/AuditTab';
import DiagnosisTab from '@/components/DiagnosisTab';

type SidebarTab = 
  | 'overview' 
  | 'executive' 
  | 'optimization' 
  | 'content' 
  | 'funnel' 
  | 'kpis' 
  | 'mapping' 
  | 'connections' 
  | 'audit'
  | 'diagnosis';

interface AdAccountOption {
  accountId: string;
  accountName: string;
  currency?: string;
  timezoneName?: string;
  status?: string | null;
}

interface ConnectionItem {
  id: string;
  connectionName: string;
  adAccounts?: AdAccountOption[];
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = React.useState<SidebarTab>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  
  // Single-user authentication state
  const [isAuthenticated, setIsAuthenticated] = React.useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = React.useState('');
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loggingIn, setLoggingIn] = React.useState(false);

  // Global Filters
  const [selectedAccount, setSelectedAccount] = React.useState('act_2938472948');
  const [dateFrom, setDateFrom] = React.useState('2026-05-15');
  const [dateTo, setDateTo] = React.useState('2026-06-14');
  const [campus, setCampus] = React.useState('');
  const [grade, setGrade] = React.useState('');
  const [source] = React.useState('');
  
  const [triggerRefresh, setTriggerRefresh] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [accountsList, setAccountsList] = React.useState<AdAccountOption[]>([]);

  // Check auth session on mount
  React.useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        setIsAuthenticated(!!data.user);
      } catch {
        setIsAuthenticated(false);
      }
    }
    checkAuth();
  }, []);

  // Fetch Accounts to populate dropdown
  React.useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    async function loadAccounts() {
      try {
        const res = await fetch('/api/meta/connections');
        const data = (await res.json()) as { connections?: ConnectionItem[] };
        if (!ignore && data.connections) {
          const map = new Map<string, AdAccountOption>();
          data.connections.forEach(conn => {
            if (conn.adAccounts) {
              conn.adAccounts.forEach(acc => {
                map.set(acc.accountId, acc);
              });
            }
          });
          setAccountsList(Array.from(map.values()));
        }
      } catch {
        // Ignored
      }
    }

    loadAccounts();
    return () => {
      ignore = true;
    };
  }, [triggerRefresh, isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginPassword.trim()) {
      setLoginError('Vui lòng nhập mật khẩu');
      return;
    }
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setTriggerRefresh(prev => prev + 1);
      } else {
        setLoginError(data.error || 'Mật khẩu không chính xác');
      }
    } catch (err: unknown) {
      setLoginError((err as Error).message || 'Lỗi kết nối máy chủ');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setIsAuthenticated(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/recommendations/generate', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setTriggerRefresh(prev => prev + 1);
        alert('Đồng bộ dữ liệu Meta thành công! Đã cập nhật Insights & Đề xuất tối ưu mới.');
      } else {
        alert(result.error || 'Sync failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSeedDemoData = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const res = await fetch('/api/sync/seed', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setTriggerRefresh(prev => prev + 1);
        alert('Database đã được Reset & Ghi nạp dữ liệu Mock mẫu hoàn chỉnh.');
      } else {
        alert(result.error || 'Seed failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert('Error: ' + message);
    } finally {
      setSeeding(false);
    }
  };

  // Single-user navigation items (all unlocked)
  const navigationItems = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'executive', label: 'Executive Dashboard', icon: Target },
    { key: 'optimization', label: 'Ads Optimization', icon: Activity },
    { key: 'content', label: 'Content Performance', icon: BarChart2 },
    { key: 'funnel', label: 'Funnel Analysis', icon: Layers },
    { key: 'diagnosis', label: 'QL Diagnosis', icon: ShieldAlert },
    { key: 'kpis', label: 'KPI Settings', icon: FolderKanban },
    { key: 'mapping', label: 'Content Mapping', icon: ClipboardList },
    { key: 'connections', label: 'Meta API Settings', icon: Settings },
    { key: 'audit', label: 'Audit Logs', icon: Users },
  ];

  const renderActiveTabContent = () => {
    const filters = {
      accountId: selectedAccount,
      dateFrom,
      dateTo,
      campus,
      grade,
      source
    };

    switch (activeTab) {
      case 'overview':
        return <OverviewTab filters={filters} triggerRefresh={triggerRefresh} />;
      case 'executive':
        return (
          <ExecutiveTab 
            filters={{ dateFrom, dateTo }} 
            currentRole="admin" 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'optimization':
        return <OptimizationTab filters={filters} triggerRefresh={triggerRefresh} />;
      case 'content':
        return (
          <ContentTab 
            filters={{ dateFrom, dateTo }} 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'funnel':
        return <FunnelTab filters={filters} triggerRefresh={triggerRefresh} />;
      case 'kpis':
        return (
          <KpiTab 
            currentRole="admin" 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'mapping':
        return (
          <MappingTab 
            currentRole="admin" 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'connections':
        return (
          <ConnectionTab 
            currentRole="admin" 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'audit':
        return <AuditTab triggerRefresh={triggerRefresh} />;
      case 'diagnosis':
        return <DiagnosisTab filters={filters} triggerRefresh={triggerRefresh} />;
      default:
        return <OverviewTab filters={filters} triggerRefresh={triggerRefresh} />;
    }
  };

  // Auth Loading
  if (isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070b13] text-slate-400 text-xs">
        Đang khởi động hệ thống...
      </div>
    );
  }

  // Single-User Login Gate
  if (isAuthenticated === false) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#070b13] p-4 selection:bg-indigo-500 selection:text-white">
        <div className="max-w-sm w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl text-indigo-400 mb-2">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-black text-slate-100 tracking-tight">DeweyMKTapp</h1>
            <p className="text-xs text-slate-400">Marketing Analytics & Meta Ads Optimization</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-3xs font-extrabold uppercase text-slate-400 mb-1.5">
                Mật khẩu truy cập
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
            </div>

            {loginError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-3xs text-rose-400 font-medium">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/25 transition-all"
            >
              {loggingIn ? 'Đang xác thực...' : 'Đăng nhập Dashboard'}
            </button>
          </form>

          <div className="text-center text-4xs text-slate-500 font-mono">
            Single-User Protected Environment • The Dewey Schools
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#070b13] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className={`fixed inset-y-0 left-0 z-50 bg-slate-900/40 backdrop-blur-3xl border-r border-slate-800/80 flex flex-col justify-between transition-all duration-300 ${isSidebarOpen ? 'w-64' : 'w-20'}`}>
        <div>
          {/* Logo & Toggle */}
          <div className="p-5 flex items-center justify-between">
            {isSidebarOpen ? (
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-600/30">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="font-black text-sm tracking-tight text-slate-100">DeweyMKTapp</h1>
                  <span className="text-4xs text-slate-500 font-bold block uppercase tracking-wider">Internal Ads Ops</span>
                </div>
              </div>
            ) : (
              <div className="mx-auto p-2 bg-indigo-600 rounded-xl">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
            )}
            
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 rounded-lg transition-all"
            >
              {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>

          {/* Nav Links */}
          <nav className="px-3 space-y-1">
            {navigationItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveTab(item.key as SidebarTab)}
                  className={`w-full flex items-center space-x-3.5 px-4 py-3 text-xs font-bold rounded-xl transition-all ${isActive ? 'bg-indigo-600/95 text-white shadow-lg shadow-indigo-600/25 border-l-3 border-indigo-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/20'}`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-350'}`} />
                  {isSidebarOpen && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-slate-800/60">
          {isSidebarOpen ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-4xs text-slate-500">
                <span>Database</span>
                <span className="text-emerald-400 font-bold">Neon Postgres</span>
              </div>
              <div className="flex items-center justify-between text-4xs text-slate-500">
                <span>API Status</span>
                <span className="text-emerald-400 font-bold">v25.0 Live</span>
              </div>
            </div>
          ) : (
            <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto" />
          )}
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className={`flex-1 transition-all duration-300 ${isSidebarOpen ? 'pl-64' : 'pl-20'} min-h-screen flex flex-col`}>
        
        {/* TOP FILTER BAR */}
        <header className="sticky top-0 z-40 bg-[#070b13]/80 backdrop-blur-xl border-b border-slate-800/80 px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            {/* Ad Account Selector */}
            <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 shadow-inner">
              <span className="text-3xs text-slate-400 font-bold uppercase tracking-wider">Account:</span>
              <select 
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-xs font-semibold focus:outline-none cursor-pointer max-w-[200px] truncate"
              >
                {accountsList.length > 0 ? (
                  accountsList.map(acc => (
                    <option key={acc.accountId} value={acc.accountId} className="bg-slate-900 text-slate-200">
                      {acc.accountName || acc.accountId}
                    </option>
                  ))
                ) : (
                  <option value="act_2938472948" className="bg-slate-900 text-slate-200">
                    Dewey Main (Demo)
                  </option>
                )}
              </select>
            </div>

            {/* Campus Selector */}
            <div className="flex items-center space-x-1.5 bg-slate-900/50 border border-slate-800/60 rounded-xl px-3 py-1.5">
              <span className="text-3xs text-slate-400 font-bold">Campus:</span>
              <select 
                value={campus}
                onChange={e => setCampus(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs font-semibold focus:outline-none"
              >
                <option value="" className="bg-slate-900">Tất cả</option>
                <option value="CG" className="bg-slate-900">Cầu Giấy</option>
                <option value="THT" className="bg-slate-900">Tây Hồ Tây</option>
                <option value="OP" className="bg-slate-900">Ocean Park</option>
                <option value="HP" className="bg-slate-900">Hải Phòng</option>
                <option value="HO" className="bg-slate-900">Head Office</option>
              </select>
            </div>

            {/* Grade Selector */}
            <div className="flex items-center space-x-1.5 bg-slate-900/50 border border-slate-800/60 rounded-xl px-3 py-1.5">
              <span className="text-3xs text-slate-400 font-bold">Grade:</span>
              <select 
                value={grade}
                onChange={e => setGrade(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs font-semibold focus:outline-none"
              >
                <option value="" className="bg-slate-900">Tất cả</option>
                <option value="G1" className="bg-slate-900">Lớp 1</option>
                <option value="G6" className="bg-slate-900">Lớp 6</option>
                <option value="G10" className="bg-slate-900">Lớp 10</option>
              </select>
            </div>
          </div>

          {/* Quick Date Range & Action Buttons */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs focus:outline-none w-20"
              />
              <span className="text-3xs text-slate-600">-</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs focus:outline-none w-20"
              />
            </div>

            {/* Single User Badge & Logout */}
            <div className="flex items-center space-x-2 bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-300 text-3xs font-bold">Admin</span>
              <button
                onClick={handleLogout}
                className="text-4xs text-slate-500 hover:text-rose-400 transition-colors ml-1 font-semibold"
                title="Đăng xuất"
              >
                (Thoát)
              </button>
            </div>

            {/* Sync Now Action */}
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              className="flex items-center space-x-1.5 px-4.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/15 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            {/* Seed Demo Data Button */}
            <button
              onClick={handleSeedDemoData}
              disabled={seeding}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl text-3xs font-bold transition-all border border-slate-700"
              title="Reset và nạp lại dữ liệu Mock hoàn chỉnh"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>{seeding ? 'Seeding...' : 'Reset Demo'}</span>
            </button>
          </div>
        </header>

        {/* DYNAMIC TAB VIEW */}
        <div className="flex-1 p-8">
          {renderActiveTabContent()}
        </div>

      </main>
    </div>
  );
}
