import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import EditBookingModal from './EditBookingModal';

/**
 * Форматирует объект Date в локальную дату формата 'ДД.ММ.ГГГГ'.
 */
function formatRussianDateFromObj(dateObj) {
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Форматирует объект Date в локальное время формата 'HH:MM'.
 */
function formatLocalHHMMFromObj(dateObj) {
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Возвращает читаемый статус и стили бейджа для записи.
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
    case 'completed':
      return {
        label: 'Завершена',
        badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
      };
    default:
      return {
        label: status || 'Активна',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

/**
 * Компонент списка записей клиентов для кабинета мастера.
 * Загружает записи из таблицы `bookings` по `master.id`, отображает дату, время,
 * услугу, клиента, индивидуальную длительность и позволяет изменить или отменить запись.
 */
export default function MasterBookingsList({ master }) {
  const [bookings, setBookings] = useState([]);
  const [filterMode, setFilterMode] = useState('active'); // 'active' | 'cancelled' | 'all'
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const fetchMasterBookings = useCallback(async () => {
    if (!master?.id) {
      setBookings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('bookings')
        .select(
          `
          id,
          client_id,
          master_id,
          service_id,
          slot_time,
          duration_minutes,
          status,
          services (title, price, duration_minutes),
          client:users!bookings_client_id_fkey (full_name, phone)
        `
        )
        .eq('master_id', master.id)
        .order('slot_time', { ascending: true });

      if (!fetchError) {
        setBookings(data || []);
        return;
      }

      const [
        { data: plainBookings, error: plainError },
        { data: usersRows },
        { data: servicesRows },
      ] = await Promise.all([
        supabase
          .from('bookings')
          .select('id, client_id, master_id, service_id, slot_time, duration_minutes, status')
          .eq('master_id', master.id)
          .order('slot_time', { ascending: true }),
        supabase.from('users').select('id, full_name, phone'),
        supabase.from('services').select('id, title, price, duration_minutes'),
      ]);

      if (plainError) throw plainError;

      const usersMap = new Map((usersRows || []).map((u) => [u.id, u]));
      const servicesMap = new Map((servicesRows || []).map((s) => [s.id, s]));

      const enriched = (plainBookings || []).map((row) => ({
        ...row,
        client: usersMap.get(row.client_id) || null,
        services: servicesMap.get(row.service_id) || null,
      }));

      setBookings(enriched);
    } catch (err) {
      console.error('Ошибка загрузки записей мастера:', err.message);
      setError('Не удалось загрузить записи клиентов. Проверьте подключение и права доступа.');
    } finally {
      setLoading(false);
    }
  }, [master?.id]);

  useEffect(() => {
    fetchMasterBookings();
  }, [fetchMasterBookings]);

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
        .eq('master_id', master.id);

      if (updateError) throw updateError;

      setBookings((prev) =>
        prev.map((item) =>
          item.id === booking.id ? { ...item, status: 'cancelled' } : item
        )
      );
      setNotice('Запись отменена. Слот снова доступен для клиентов.');
    } catch (err) {
      console.error('Ошибка отмены записи мастером:', err.message);
      setError('Не удалось отменить запись. Попробуйте ещё раз.');
    } finally {
      setCancellingId(null);
    }
  };

  const filteredBookings = useMemo(() => {
    if (filterMode === 'all') return bookings;
    if (filterMode === 'cancelled') {
      return bookings.filter((b) => b.status === 'cancelled');
    }
    return bookings.filter((b) => b.status !== 'cancelled');
  }, [bookings, filterMode]);

  const activeCount = useMemo(
    () => bookings.filter((b) => b.status !== 'cancelled').length,
    [bookings]
  );

  return (
    <section className="bg-white text-slate-900 rounded-2xl shadow-md border border-slate-200 p-6 space-y-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Записи клиентов ({activeCount} активных)
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Все записи к вам как к мастеру. При отмене записи статус меняется на «Отменена», а слот освобождается.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchMasterBookings}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-900 transition cursor-pointer disabled:opacity-60"
        >
          {loading ? 'Обновляем...' : 'Обновить'}
        </button>
      </div>

      {/* Переключатель фильтра записей */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'active', label: 'Активные' },
          { id: 'cancelled', label: 'Отменённые' },
          { id: 'all', label: 'Все записи' },
        ].map((tab) => {
          const isActive = filterMode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
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
        <p className="text-sm text-slate-500 py-4">Загружаем записи клиентов...</p>
      ) : filteredBookings.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600">
          В выбранном фильтре записей пока нет.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBookings.map((booking) => {
            const slotDate = booking.slot_time ? new Date(booking.slot_time) : null;
            const isValidDate = slotDate && !Number.isNaN(slotDate.getTime());
            const dateStr = isValidDate ? formatRussianDateFromObj(slotDate) : '—';
            const timeStr = isValidDate ? formatLocalHHMMFromObj(slotDate) : '—';

            const statusMeta = getStatusMeta(booking.status);
            const isCancellable = booking.status !== 'cancelled';
            const isCancelling = cancellingId === booking.id;

            const effectiveDuration =
              Number(booking.duration_minutes) ||
              Number(booking.services?.duration_minutes) ||
              60;
            const baseDuration =
              Number(booking.services?.duration_minutes) || effectiveDuration;
            const freedMinutes =
              effectiveDuration < baseDuration ? baseDuration - effectiveDuration : 0;

            const serviceTitle = booking.services?.title || 'Услуга';
            const servicePrice = booking.services?.price;
            const clientName = booking.client?.full_name || 'Клиент';
            const clientPhone = booking.client?.phone || '';

            return (
              <div
                key={booking.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{serviceTitle}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${statusMeta.badgeClass}`}
                    >
                      {statusMeta.label}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Дата: <strong className="text-slate-900">{dateStr}</strong>
                    </span>
                    <span>
                      Время: <strong className="text-slate-900">{timeStr}</strong>
                    </span>
                    <span>
                      Клиент: <strong className="text-slate-900">{clientName}</strong>
                      {clientPhone ? ` (${clientPhone})` : ''}
                    </span>
                    <span>
                      Длительность: <strong className="text-slate-900">{effectiveDuration} мин</strong>
                      {baseDuration !== effectiveDuration ? ` (по прайсу: ${baseDuration} мин)` : ''}
                    </span>
                    {typeof servicePrice === 'number' ? (
                      <span>Стоимость: {servicePrice.toLocaleString('ru-RU')} ₽</span>
                    ) : null}
                    {freedMinutes > 0 ? (
                      <span className="text-emerald-700 font-semibold">
                        Освободилось: {freedMinutes} мин (слот доступен для записи)
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isCancellable ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingBooking(booking)}
                        className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition cursor-pointer"
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(booking)}
                        disabled={isCancelling}
                        className="px-4 py-2 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {isCancelling ? 'Отменяем...' : 'Отменить запись'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">Отменена</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          onClose={() => setEditingBooking(null)}
          onSaved={(updatedBooking) => {
            setBookings((prev) =>
              prev.map((item) =>
                item.id === updatedBooking.id ? { ...item, ...updatedBooking } : item
              )
            );
            const baseDur = Number(updatedBooking.services?.duration_minutes) || 0;
            const newDur = Number(updatedBooking.duration_minutes) || 0;
            const freed = baseDur > 0 && newDur > 0 && newDur < baseDur ? baseDur - newDur : 0;
            setNotice(
              freed > 0
                ? `Запись обновлена (${newDur} мин). Освободилось ${freed} мин — слоты в это окно доступны.`
                : 'Запись обновлена.'
            );
            setEditingBooking(null);
          }}
        />
      )}
    </section>
  );
}