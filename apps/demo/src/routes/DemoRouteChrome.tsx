import { Link } from 'react-router-dom';
import { ThemeModeSwitch } from '../theme/ThemeModeSwitch.tsx';

interface DemoRouteLink {
  icon?: 'overview';
  label: string;
  to: string;
}

interface DemoSidebarHeaderProps {
  links: readonly DemoRouteLink[];
  title: string;
}

interface InteractionCheatSheetProps {
  groups: readonly {
    items: readonly {
      action: string;
      keys: readonly string[];
    }[];
    label: string;
  }[];
  tryItems?: readonly {
    detail: string;
    label: string;
  }[];
}

export function DemoSidebarHeader({ links, title }: DemoSidebarHeaderProps) {
  return (
    <section className="demo-sidebar-header">
      <div className="demo-sidebar-title-row">
        <h1>{title}</h1>
        <ThemeModeSwitch />
      </div>
      <nav className="route-links" aria-label="Plot navigation">
        {links.map((link) => (
          <Link key={`${link.label}-${link.to}`} to={link.to}>
            {link.icon === 'overview' ? <OverviewIcon /> : null}
            {link.label}
          </Link>
        ))}
      </nav>
    </section>
  );
}

function OverviewIcon() {
  return (
    <svg
      aria-hidden="true"
      className="route-link-icon"
      fill="none"
      focusable="false"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="2.5" y="2.5" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="8.5" y="2.5" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="2.5" y="8.5" />
      <rect height="5" rx="1" stroke="currentColor" strokeWidth="1.5" width="5" x="8.5" y="8.5" />
    </svg>
  );
}

export function InteractionCheatSheet({ groups, tryItems }: InteractionCheatSheetProps) {
  return (
    <section className="control-section interaction-cheat-sheet interaction-guide">
      <h2>How to interact</h2>
      {tryItems === undefined || tryItems.length === 0 ? null : (
        <ol className="try-this-list interaction-guide-list">
          {tryItems.map((item) => (
            <li key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ol>
      )}
      <details className="control-disclosure shortcut-help">
        <summary>Advanced gestures</summary>
        <div className="control-disclosure-body">
          <div className="interaction-cheat-sheet-grid">
            {groups.map((group) => (
              <div className="interaction-cheat-sheet-group" key={group.label}>
                <strong>{group.label}</strong>
                <dl className="interaction-shortcut-list">
                  {group.items.map((item) => (
                    <div key={`${group.label}-${item.keys.join('-')}-${item.action}`}>
                      <dt>
                        {item.keys.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </dt>
                      <dd>{item.action}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
