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

export default function DashboardPage() {
  const [activeTab, setActiveTab] = React.useState<SidebarTab>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  
  // Global Filters
  const [selectedAccount, setSelectedAccount] = React.useState('act_2938472948');
  const [dateFrom, setDateFrom] = React.useState('2026-05-15');
  const [dateTo, setDateTo] = React.useState('2026-06-14'); // Current mock date boundary
  const [campus, setCampus] = React.useState('');
  const [grade, setGrade] = React.useState('');
  const [source, setSource] = React.useState('');
  
  // Role Switcher for instant Demo
  const [role, setRole] = React.useState('admin'); // default admin for complete access
  
  const [triggerRefresh, setTriggerRefresh] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [accountsList, setAccountsList] = React.useState<any[]>([]);

  // Fetch Accounts to populate dropdown
  const loadAccounts = React.useCallback(async () => {
    try {
      const res = await fetch('/api/meta/connections');
      const data = await res.json();
      if (data.connections) {
        const list: any[] = [];
        data.connections.forEach((conn: any) => {
          if (conn.adAccounts) list.push(...conn.adAccounts);
        });
        setAccountsList(list);
      }
    } catch (_) {}
  }, []);

  React.useEffect(() => {
    loadAccounts();
  }, [triggerRefresh, loadAccounts]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      // Simulate real background sync trigger
      const res = await fetch('/api/recommendations/generate', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setTriggerRefresh(prev => prev + 1);
        alert('Đồng bộ dữ liệu Meta thành công! Đã cập nhật Insights & Đề xuất tối ưu mới.');
      } else {
        alert(result.error || 'Sync failed');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
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
        alert('Database đã được Reset & Ghi nạp dữ liệu Mock mẫu hoàn chỉnh. Bạn có thể sử dụng đầy đủ chức năng của Dashboard.');
      } else {
        alert(result.error || 'Seed failed');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSeeding(false);
    }
  };

  const navigationItems = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'executive', label: 'Executive Dashboard', icon: Target },
    { key: 'optimization', label: 'Ads Optimization', icon: Activity },
    { key: 'content', label: 'Content Performance', icon: BarChart2 },
    { key: 'funnel', label: 'Funnel Analysis', icon: Layers },
    { key: 'diagnosis', label: 'QL Diagnosis', icon: ShieldAlert, roles: ['admin', 'manager', 'ads_specialist'] },
    { key: 'kpis', label: 'KPI Settings', icon: FolderKanban, roles: ['admin', 'manager'] },
    { key: 'mapping', label: 'Content Mapping', icon: ClipboardList, roles: ['admin', 'manager', 'ads_specialist', 'content'] },
    { key: 'connections', label: 'Meta API Settings', icon: Settings, roles: ['admin'] },
    { key: 'audit', label: 'Audit Logs', icon: Users, roles: ['admin'] },
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
            currentRole={role} 
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
            currentRole={role} 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'mapping':
        return (
          <MappingTab 
            currentRole={role} 
            triggerRefresh={triggerRefresh}
            onRefresh={() => setTriggerRefresh(prev => prev + 1)}
          />
        );
      case 'connections':
        return (
          <ConnectionTab 
            currentRole={role} 
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

  return (
    <div className="flex min-h-screen bg-[#070b13] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden">
      
      {/* SIDEBAR NAVIGATION */}
      <aside 
        className={`bg-[#0b1325]/90 border-r border-slate-900 backdrop-blur-md transition-all duration-300 shrink-0 flex flex-col justify-between ${isSidebarOpen ? 'w-64' : 'w-20'}`}
      >
        <div className="space-y-6">
          {/* Logo Header */}
          <div className="h-16 border-b border-slate-900 flex items-center justify-between px-5">
            {isSidebarOpen ? (
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center font-black text-white text-md shadow-lg shadow-indigo-650">
                  A
                </div>
                <span className="font-extrabold text-sm tracking-wider bg-gradient-to-r from-indigo-200 to-slate-200 bg-clip-text text-transparent">
                  ADS COMMAND
                </span>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center font-black text-white text-md mx-auto shadow-lg shadow-indigo-650">
                A
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
              // Hide tabs if role doesn't match
              if (item.roles && !item.roles.includes(role)) return null;
              
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

        {/* Sidebar Footer Seeder */}
        <div className="p-3 border-t border-slate-900 space-y-2 bg-slate-950/20">
          <button
            onClick={handleSeedDemoData}
            disabled={seeding}
            className="w-full flex items-center justify-center space-x-1.5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-indigo-400 font-extrabold text-3xs border border-indigo-500/20 rounded-xl transition-colors shadow-inner"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isSidebarOpen && <span>{seeding ? 'Seeding...' : 'Seed Demo Data'}</span>}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT WRAPPER */}
      <main className="flex-1 flex flex-col min-h-screen">
        
        {/* TOPBAR FILTERS */}
        <header className="h-20 border-b border-slate-900 bg-[#070b13]/60 backdrop-blur-md flex flex-wrap items-center justify-between px-6 sticky top-0 z-40 gap-4 py-2">
          
          {/* Left: Accounts selector */}
          <div className="flex items-center space-x-3">
            <label className="text-slate-500 text-3xs font-semibold uppercase tracking-wider hidden sm:block">Account</label>
            <select
              value={selectedAccount}
              onChange={e => setSelectedAccount(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold focus:outline-none focus:border-indigo-500"
            >
              <option value="act_2938472948">Dewey School Global Campaigns (act_2938472948)</option>
              {accountsList.map(acc => (
                <option key={acc.accountId} value={acc.accountId}>
                  {acc.accountName} ({acc.accountId})
                </option>
              ))}
            </select>
          </div>

          {/* Right: Dates and Segment filters */}
          <div className="flex flex-wrap items-center gap-3">
            
            {/* Campus selector */}
            <select
              value={campus}
              onChange={e => setCampus(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none"
            >
              <option value="">Cơ sở (Campus)</option>
              <option value="CG">CG (Cầu Giấy)</option>
              <option value="THT">THT (Tây Hồ)</option>
              <option value="HP">HP (Hải Phòng)</option>
            </select>

            {/* Grade selector */}
            <select
              value={grade}
              onChange={e => setGrade(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none"
            >
              <option value="">Khối lớp (Grade)</option>
              <option value="G1">G1 (Khối 1)</option>
              <option value="G6">G6 (Khối 6)</option>
              <option value="G10">G10 (Khối 10)</option>
            </select>

            {/* Date Range selectors */}
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-xl px-2 py-1">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs focus:outline-none w-20"
              />
              <span className="text-slate-600 text-xs">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="bg-transparent border-0 text-slate-200 text-3xs focus:outline-none w-20"
              />
            </div>

            {/* Role Switcher Demo */}
            <div className="flex items-center space-x-1.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl px-3 py-1.5">
              <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
              <select
                value={role}
                onChange={e => {
                  const newRole = e.target.value;
                  setRole(newRole);
                  // Auto redirect if page is restricted for this role
                  const restrictedItems = navigationItems.filter(i => i.roles && !i.roles.includes(newRole));
                  if (restrictedItems.some(i => i.key === activeTab)) {
                    setActiveTab('overview');
                  }
                }}
                className="bg-transparent border-0 text-indigo-300 text-3xs font-extrabold focus:outline-none"
              >
                <option value="admin" className="bg-slate-900 text-slate-300">Admin</option>
                <option value="manager" className="bg-slate-900 text-slate-300">Manager</option>
                <option value="ads_specialist" className="bg-slate-900 text-slate-300">Ads Specialist</option>
                <option value="content" className="bg-slate-900 text-slate-300">Content</option>
                <option value="viewer" className="bg-slate-900 text-slate-300">Viewer</option>
              </select>
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

          </div>

        </header>

        {/* INNER DYNAMIC TAB WRAPPER */}
        <section className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto pb-16">
          {renderActiveTabContent()}
        </section>

      </main>

    </div>
  );
}
