import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import DashboardHome from './DashboardHome';
import './ClientDashboard.css';

const CLIENT_TILES = [
  {
    id: 'book',
    label: 'Записаться',
    modifier: 'dashboard-tile--calendar',
  },
  {
    id: 'archive',
    label: 'Архив записей',
    modifier: 'dashboard-tile--bookings',
  },
  {
    id: 'about',
    label: 'О нас',
    modifier: 'dashboard-tile--price',
  },
  {
    id: 'settings',
    label: 'Настройки',
    modifier: 'dashboard-tile--report',
  },
];

function formatRussianDate(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatTimeHHMM(dateObj) {
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function ClientDashboardHome({
  client,
  refreshKey = 0,
  onNavigate,
}) {
  const [nextBooking, setNextBooking] = useState(null);
  const [loadingReminder, setLoadingReminder] = useState(true);

  const fetchActiveReminder = useCallback(async () => {
    if (!client?.id) {
      setNextBooking(null);
      setLoadingReminder(false);
      return;
    }

    setLoadingReminder(true);
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, slot_time, status, services(title, duration_minutes), users!bookings_master_id_fkey(full_name)')
        .eq('client_id', client.id)
        .neq('status', 'cancelled')
        .order('slot_time', { ascending: true });

      if (error) {
        throw error;
      }

      const nowMs = Date.now();
      const upcoming = (data || [])
        .map((row) => {
          const startDate = row.slot_time ? new Date(row.slot_time) : null;
          if (!startDate || Number.isNaN(startDate.getTime())) return null;
          const duration = Number(row.services?.duration_minutes) || 60;
          const endMs = startDate.getTime() + duration * 60 * 1000;
          return {
            id: row.id,
            startDate,
            endMs,
            serviceTitle: row.services?.title || 'Услуга',
            masterName: row.users?.full_name || 'Мастер',
            status: row.status || 'confirmed',
          };
        })
        .filter((item) => item && item.endMs >= nowMs)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      setNextBooking(upcoming[0] || null);
    } catch (err) {
      console.warn('Не удалось загрузить напоминание об активной записи:', err.message);
      setNextBooking(null);
    } finally {
      setLoadingReminder(false);
    }
  }, [client?.id]);

  useEffect(() => {
    fetchActiveReminder();
  }, [fetchActiveReminder, refreshKey]);

  return (
    <div className="client-dashboard-shell">
      {/* 4 квадратных блока по центру */}
      <DashboardHome
        title={`Добро пожаловать, ${client?.full_name || 'Клиент'}`}
        subtitle="Выберите раздел для работы"
        tiles={CLIENT_TILES}
        onNavigate={(pageId) => {
          if (typeof onNavigate === 'function') {
            onNavigate(pageId);
          }
        }}
      />

      {/* Плашка-напоминание с активной записью внизу */}
      <aside
        className="client-reminder-banner"
        aria-label="Напоминание об активной записи"
      >
        {loadingReminder ? (
          <div>
            <p className="client-reminder-banner__eyebrow">Активная запись</p>
            <p className="client-reminder-banner__meta">Проверяем ближайшую запись...</p>
          </div>
        ) : nextBooking ? (
          <>
            <div>
              <p className="client-reminder-banner__eyebrow">Напоминание • Активная запись</p>
              <h3 className="client-reminder-banner__title">
                {nextBooking.serviceTitle} — {formatRussianDate(nextBooking.startDate)} в{' '}
                {formatTimeHHMM(nextBooking.startDate)}
              </h3>
              <p className="client-reminder-banner__meta">
                Мастер: {nextBooking.masterName}
              </p>
            </div>
            <div className="client-reminder-banner__actions">
              <button
                type="button"
                onClick={() => onNavigate?.('archive')}
                className="client-reminder-banner__btn client-reminder-banner__btn--secondary"
              >
                Мои записи
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('book')}
                className="client-reminder-banner__btn"
              >
                Записаться ещё
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="client-reminder-banner__eyebrow">Активная запись</p>
              <h3 className="client-reminder-banner__title">
                У вас пока нет активных записей
              </h3>
              <p className="client-reminder-banner__meta">
                Выберите услугу, мастера и удобное время в разделе «Записаться».
              </p>
            </div>
            <div className="client-reminder-banner__actions">
              <button
                type="button"
                onClick={() => onNavigate?.('book')}
                className="client-reminder-banner__btn"
              >
                Записаться
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}