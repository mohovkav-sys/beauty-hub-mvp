import React from 'react';
import './DashboardHome.css';

const MASTER_TILES = [
  {
    id: 'price',
    label: 'Прайс',
    modifier: 'dashboard-tile--price',
    icon: 'tag',
  },
  {
    id: 'calendar',
    label: 'Календарь',
    modifier: 'dashboard-tile--calendar',
    icon: 'calendar',
  },
  {
    id: 'bookings',
    label: 'Записи',
    modifier: 'dashboard-tile--bookings',
    icon: 'bookings',
  },
  {
    id: 'report',
    label: 'Отчет',
    badge: 'Скоро',
    modifier: 'dashboard-tile--report',
    icon: 'report',
  },
];

function TileIcon({ name }) {
  switch (name) {
    case 'tag':
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case 'bookings':
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="13" y2="16" />
        </svg>
      );
    case 'about':
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    case 'settings':
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'report':
    default:
      return (
        <svg className="dashboard-tile__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
  }
}

export function ReportStubPage({ onBack }) {
  return (
    <div className="dashboard-home">
      <div className="report-placeholder">
        <div className="dashboard-tile__icon-box" style={{ margin: '0 auto' }}>
          <TileIcon name="report" />
        </div>
        <h2 className="report-placeholder__title">Раздел «Отчет»</h2>
        <p className="report-placeholder__desc">
          Аналитика и сводные отчеты появятся в следующих версиях сервиса.
        </p>
        <button
          type="button"
          className="report-placeholder__back-btn"
          onClick={onBack}
        >
          ← Назад на главную
        </button>
      </div>
    </div>
  );
}

export default function DashboardHome({
  title = 'Личный кабинет',
  subtitle = 'Выберите раздел для работы',
  tiles = MASTER_TILES,
  onNavigate,
}) {
  return (
    <section className="dashboard-home" aria-label="Навигация по разделам">
      <header className="dashboard-home__header">
        <h2 className="dashboard-home__title">{title}</h2>
        {subtitle && <p className="dashboard-home__subtitle">{subtitle}</p>}
      </header>

      <div className="dashboard-grid">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className={`dashboard-tile ${tile.modifier || ''}`}
            onClick={() => {
              if (typeof onNavigate === 'function') {
                onNavigate(tile.id);
              }
            }}
          >
            {tile.badge && <span className="dashboard-tile__badge">{tile.badge}</span>}
            <span className="dashboard-tile__icon-box" aria-hidden="true">
              <TileIcon name={tile.icon} />
            </span>
            <span className="dashboard-tile__label">{tile.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}