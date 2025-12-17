
import React, { useState, useEffect } from 'react';
import { X, Users, RefreshCw, CheckCircle2, AlertCircle, Shield, MoreHorizontal, Search, Globe, Clock, Circle } from 'lucide-react';
import { getUsers, updateUserPermission } from '../services/googleSheetService';

interface AdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: string;
}

interface UserData {
  username: string;
  createdAt: string;
  permissions: string;
  lastIp?: string;
  lastLogin?: string;
  lastActive?: string;
  currentStatus?: string; // New field
}

const PERMISSION_OPTIONS = [
  { value: 'PENDING', label: 'Pending Approval', color: 'bg-amber-900/30 text-amber-500 border-amber-900' },
  { value: 'POD', label: 'POD Only', color: 'bg-indigo-900/30 text-indigo-400 border-indigo-900' },
  { value: 'TSHIRT', label: 'T-Shirt Only', color: 'bg-purple-900/30 text-purple-400 border-purple-900' },
  { value: 'ALL', label: 'All Access', color: 'bg-green-900/30 text-green-400 border-green-900' },
  { value: 'ADMIN', label: 'Admin', color: 'bg-red-900/30 text-red-400 border-red-900' },
  { value: 'BLOCK', label: 'Blocked', color: 'bg-slate-700 text-slate-400 border-slate-600' },
];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isOpen, onClose, currentUser }) => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getUsers();
      if (res.status === 'success' && res.users) {
        setUsers(res.users);
      } else {
        setError(res.message || "Failed to fetch users");
      }
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

  const handlePermissionChange = async (username: string, newPerm: string) => {
    setUpdatingUser(username);
    try {
      const res = await updateUserPermission(username, newPerm);
      if (res.status === 'success') {
        // Optimistic update
        setUsers(users.map(u => u.username === username ? { ...u, permissions: newPerm } : u));
      } else {
        alert("Update failed: " + res.message);
      }
    } catch (e) {
      alert("Update failed due to network error");
    } finally {
      setUpdatingUser(null);
    }
  };

  // Improved Online check: Uses status column first, falls back to timestamp if "Online"
  const isUserOnline = (user: UserData) => {
    if (user.currentStatus === 'Offline') return false;
    
    // If status says online, verify with timestamp (prevent stuck online status if crash)
    if (!user.lastActive) return false;
    const lastActive = new Date(user.lastActive).getTime();
    const now = new Date().getTime();
    const diffMinutes = (now - lastActive) / 1000 / 60;
    
    // Strict 10 min timeout even if status says Online
    return diffMinutes < 10;
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.lastIp && u.lastIp.includes(searchTerm))
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl border border-slate-800 h-[85vh] flex flex-col">
          
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900 rounded-t-2xl">
            <h3 className="text-xl font-bold text-slate-200 flex items-center">
              <Shield className="w-6 h-6 mr-2 text-indigo-500" />
              User Management Dashboard
            </h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Controls */}
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-4 justify-between items-center bg-slate-900/50">
            <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 text-slate-500 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Search user or IP..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                />
            </div>
            <button 
                onClick={fetchUsers}
                disabled={loading}
                className="flex items-center px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors border border-slate-700"
            >
                <RefreshCw size={14} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
                Refresh List
            </button>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-slate-700">
             <table className="w-full text-left border-collapse">
                 <thead className="bg-slate-950 sticky top-0 z-10">
                     <tr>
                         <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">User / Status</th>
                         <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">Role</th>
                         <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">Last IP</th>
                         <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800">Activity</th>
                         <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 text-right">Actions</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-800">
                     {loading && users.length === 0 ? (
                         <tr><td colSpan={5} className="p-8 text-center text-slate-500">Loading users...</td></tr>
                     ) : error ? (
                         <tr><td colSpan={5} className="p-8 text-center text-red-500">{error}</td></tr>
                     ) : filteredUsers.length === 0 ? (
                        <tr><td colSpan={5} className="p-8 text-center text-slate-500">No users found.</td></tr>
                     ) : (
                         filteredUsers.map((user) => {
                             const currentPerm = PERMISSION_OPTIONS.find(p => p.value === user.permissions) || PERMISSION_OPTIONS[0];
                             const isMe = user.username === currentUser;
                             const online = isUserOnline(user);

                             return (
                                 <tr key={user.username} className="hover:bg-slate-800/50 transition-colors">
                                     <td className="p-4">
                                         <div className="flex items-center">
                                             <div className="relative">
                                                 <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-bold mr-3 border border-slate-700">
                                                     {user.username.charAt(0).toUpperCase()}
                                                 </div>
                                                 <div className={`absolute -bottom-1 right-2 w-3 h-3 border-2 border-slate-900 rounded-full ${online ? 'bg-green-500' : 'bg-slate-600'}`} title={online ? "Online" : "Offline"}></div>
                                             </div>
                                             <div>
                                                 <div className="font-medium text-slate-200 flex items-center">
                                                     {user.username}
                                                     {isMe && <span className="ml-2 text-[10px] text-indigo-400 bg-indigo-900/20 px-1.5 py-0.5 rounded">You</span>}
                                                 </div>
                                                 <div className={`text-xs flex items-center ${online ? 'text-green-400 font-bold' : 'text-slate-500'}`}>
                                                     <Circle size={6} className={`mr-1 fill-current`} />
                                                     {online ? 'Online' : 'Offline'}
                                                 </div>
                                             </div>
                                         </div>
                                     </td>
                                     <td className="p-4">
                                         <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${currentPerm.color}`}>
                                             {user.permissions === 'PENDING' && <AlertCircle size={12} className="mr-1" />}
                                             {user.permissions === 'ADMIN' && <Shield size={12} className="mr-1" />}
                                             {currentPerm.label}
                                         </span>
                                     </td>
                                     <td className="p-4">
                                         <div className="flex items-center text-sm text-slate-400 font-mono bg-slate-950 px-2 py-1 rounded w-fit border border-slate-800">
                                             <Globe size={12} className="mr-2 text-slate-600" />
                                             {user.lastIp || 'Unknown'}
                                         </div>
                                     </td>
                                     <td className="p-4 text-xs text-slate-500">
                                         <div className="flex flex-col space-y-1">
                                            <div className="flex items-center" title="Last Login">
                                                <Clock size={12} className="mr-1.5 text-slate-600" />
                                                Login: {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : '-'}
                                            </div>
                                            <div className="flex items-center text-slate-400" title="Last Active">
                                                <Clock size={12} className="mr-1.5 text-green-600" />
                                                Active: {user.lastActive ? new Date(user.lastActive).toLocaleTimeString() : '-'}
                                            </div>
                                         </div>
                                     </td>
                                     <td className="p-4 text-right">
                                         {isMe ? (
                                             <span className="text-xs text-slate-600 italic">Current User</span>
                                         ) : (
                                             <div className="relative inline-block text-left group">
                                                 {updatingUser === user.username ? (
                                                     <RefreshCw size={16} className="animate-spin text-indigo-500 mx-auto" />
                                                 ) : (
                                                     <select
                                                         value={user.permissions}
                                                         onChange={(e) => handlePermissionChange(user.username, e.target.value)}
                                                         className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg p-2 focus:border-indigo-500 outline-none cursor-pointer hover:bg-slate-800"
                                                     >
                                                         {PERMISSION_OPTIONS.map(opt => (
                                                             <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                         ))}
                                                     </select>
                                                 )}
                                             </div>
                                         )}
                                     </td>
                                 </tr>
                             );
                         })
                     )}
                 </tbody>
             </table>
          </div>
          
          <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl">
              <p className="text-xs text-slate-500 flex items-center">
                  <CheckCircle2 size={12} className="mr-1 text-green-500" />
                  Status updates in real-time. Offline users appear gray.
              </p>
          </div>
        </div>
      </div>
    </div>
  );
};
