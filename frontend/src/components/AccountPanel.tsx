import { User as UserIcon, BarChart2, ShieldCheck } from 'lucide-react';
import { AccountPanel as SharedAccountPanel, type AccountMenuItem } from '../ui';
import type { User } from '../shared/types';

interface Props {
  user: User;
  onSignOut: () => void;
  onNavigate: (page: 'account' | 'usage' | 'admin') => void;
}

export function AccountPanel({ user, onSignOut, onNavigate }: Props) {
  const items: AccountMenuItem[] = [
    { id: 'account', label: 'My Account', icon: <UserIcon size={13} />, onClick: () => onNavigate('account') },
    { id: 'usage',   label: 'Usage',      icon: <BarChart2 size={13} />, onClick: () => onNavigate('usage') },
    { id: 'admin',   label: 'Admin',      icon: <ShieldCheck size={13} />, onClick: () => onNavigate('admin'), hidden: !user.isAdmin },
  ];

  return (
    <SharedAccountPanel
      label={user.email ?? 'No email set'}
      items={items}
      onSignOut={onSignOut}
    />
  );
}
