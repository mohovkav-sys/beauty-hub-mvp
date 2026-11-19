import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Переводит объект Date в локальную дату формата 'ДД.ММ.ГГГГ'.
 *
 * @param {Date} dateObj - Объект даты в локальном часовом поясе
 * @returns {string} Дата 'ДД.ММ.ГГГГ'
 */
function formatRussianDateFromObj(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Переводит объект Date в локальное время формата 'HH:MM'.
 *
 * @param {Date} dateObj - Объект даты в локальном часовом поясе
 * @returns {string} Время 'HH:MM'
 */
function formatLocalHHMMFromObj(dateObj) {
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Возвращает читаемый label и цветовые классы Tailwind для статуса записи.
 *
 * @param {string} status - Статус из таблицы `bookings` ('pending' | 'confirmed' | 'cancelled')
 */
function getStatusMeta(status) {
  switch (status) {
    case 'confirmed':
      return {
        label: 'Подтверждена',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'pending':
      return {
        label: 'Ожидает подтверждения',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'cancelled':
      return {
        label: 'Отменена',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
      };
    default:
      return {
        label: status || 'Неизвестно',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

/**
 * Компонент «Мои записи» клиента: отображает список записей клиента
 * и позволяет отменить активную запись (статус меняется на 'cancelled').
 *
 * @param {Object} props
 * @param {Object} props.client - Профиль клиента из `users`
 * @param {number} [props.refreshKey=0] - Счётчик для принудительного обновления списка после создания записи
 * @param {Function} [props.onBookingCancelled] - Колбэк после успешной отмены записи
 */
export default function ClientBookingsList({
  client,
  refreshKey = 0,
  onBookingCancelled,
}) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  /**
   * Загружает записи текущего клиента из таблицы `bookings`
   * вместе с названием/ценой/длительностью услуги и именем мастера.
   */
  const fetchClientBookings = useCallback(async () => {
    if (!client?.id) {
      setBookings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Пробуем загрузить запись со связями на `services` и `master` (если внешние ключи настроены в Supabase)
      const { data, error: fetchError } = await supabase
        .from('bookings')
        .select(
          `
          id,
          client_id,
          master_id,
          service_id,
          slot_time,
          status,
          services (title, price, duration_minutes),
          master:users!bookings_master_id_fkey (full_name)
        `
        )
        .eq('client_id', client.id)
        .order('slot_time', { ascending: false });

      if (!fetchError) {
        setBookings(data || []);
        return;
      }

      // Запасной запрос без join-алиасов, если имена связей в схеме отличаются
      const { data: plainData, error: plainError } = await supabase
        .from('bookings')
        .select('id, client_id, master_id, service_id, slot_time, status')
        .eq('client_id', client.id)
        .order('slot_time', { ascending: false });

      if (plainError) throw plainError;
      setBookings(plainData || []);
    } catch (err) {
      console.error('Ошибка загрузки записей клиента:', err.message);
      setError('Не удалось загрузить ваши записи. Проверьте подключение и права доступа.');
    } finally {
      setLoading(false);
    }
  }, [client?.id]);

  // Загружаем список при монтировании, смене клиента или при обновлении refreshKey
  useEffect(() => {
    fetchClientBookings();
  }, [fetchClientBookings, refreshKey]);

  /**
   * Переводит выбранную запись в статус 'cancelled', освобождая временный/подтверждённый слот.
   *
   * @param {Object} booking - Объект записи из `bookings`
   */
  const handleCancelBooking = async (booking) => {
    if (!booking?.id || booking.status === 'cancelled') return;

    setError(null);
    setNotice(null);
    setCancellingId(booking.id);

    try {
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', booking.id)
        .eq('client_id', client.id);

      if (updateError) throw updateError;

      // Обновляем локальный список сразу, чтобы интерфейс реагировал мгновенно
      setBookings((prev) =>
        prev.map((item) =>
          item.id === booking.id ? { ...item, status: 'cancelled' } : item
        )
      );

      setNotice('Запись отменена. Слот снова освобождён для бронирования.');

      if (typeof onBookingCancelled === 'function') {
        onBookingCancelled(booking);
      }
    } catch (err) {
      console.error('Ошибка отмены записи:', err.message);
      setError('Не удалось отменить запись. Попробуйте ещё раз.');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <section className="bg-surface text-ink rounded-2xl shadow-md border border-slate-200 p-6 space-y-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-brand-dark">Мои записи</h2>
          <p className="text-sm text-muted mt-0.5">
            История и актуальные бронирования. Отменённые слоты автоматически освобождаются.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchClientBookings}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-ink transition cursor-pointer disabled:opacity-60"
        >
          {loading ? 'Обновляем...' : 'Обновить список'}
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-medium"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-medium"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted py-4">Загружаем ваши записи...</p>
      ) : bookings.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-muted">
          У вас пока нет записей. Выберите мастера, услугу и время выше, чтобы оформить первый визит.
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const slotDate = booking.slot_time ? new Date(booking.slot_time) : null;
            const isValidDate = slotDate && !Number.isNaN(slotDate.getTime());
            const dateStr = isValidDate ? formatRussianDateFromObj(slotDate) : '—';
            const timeStr = isValidDate ? formatLocalHHMMFromObj(slotDate) : '—';

            const statusMeta = getStatusMeta(booking.status);
            const isCancellable = booking.status !== 'cancelled';
            const isCancelling = cancellingId === booking.id;

            const serviceTitle = booking.services?.title || 'Услуга студии';
            const servicePrice = booking.services?.price;
            const serviceDuration = booking.services?.duration_minutes;
            const masterName = booking.master?.full_name || 'Мастер Beauty Hub';

            return (
              <div
                key={booking.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink">{serviceTitle}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {statusMeta.label}
                    </span>
                  </div>

                  <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Дата: <strong className="text-ink">{dateStr}</strong>
                    </span>
                    <span>
                      Время: <strong className="text-ink">{timeStr}</strong>
                    </span>
                    <span>
                      Мастер: <strong className="text-ink">{masterName}</strong>
                    </span>
                    {serviceDuration ? <span>Длительность: {serviceDuration} мин</span> : null}
                    {typeof servicePrice === 'number' ? (
                      <span>Стоимость: {servicePrice.toLocaleString('ru-RU')} ₽</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isCancellable ? (
                    <button
                      type="button"
                      onClick={() => handleCancelBooking(booking)}
                      disabled={isCancelling}
                      className="px-4 py-2 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                    >
                      {isCancelling ? 'Отменяем...' : 'Отменить запись'}
                    </button>
                  ) : (
                    <span className="text-xs text-muted italic">Запись отменена</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}