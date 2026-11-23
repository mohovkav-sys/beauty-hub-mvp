import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

function formatLocalDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalHHMM(dateObj) {
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function formatMinutesToHHMM(totalMinutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function buildIsoFromLocalDateAndTime(dateKey, hhmm) {
  if (!dateKey || !hhmm) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = hhmm.split(':').map(Number);
  if ([year, month, day, hours, minutes].some((v) => Number.isNaN(v))) {
    return null;
  }
  const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function resolveItemDurationMinutes(item) {
  const customDur = Number(item?.duration_minutes);
  if (Number.isFinite(customDur) && customDur > 0) return customDur;

  const serviceDur = Number(item?.services?.duration_minutes);
  if (Number.isFinite(serviceDur) && serviceDur > 0) return serviceDur;

  return 60;
}

/**
 * Модальное окно изменения времени (slot_time) и индивидуальной длительности (duration_minutes) записи.
 * Проверяет пересечение с другими активными записями мастера и границы смены в `schedule`.
 */
export default function EditBookingModal({
  booking,
  onClose,
  onSaved,
}) {
  const initialDate = useMemo(() => {
    if (!booking?.slot_time) return new Date();
    const d = new Date(booking.slot_time);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [booking]);

  const initialDuration = useMemo(
    () => resolveItemDurationMinutes(booking),
    [booking]
  );

  const [dateKey, setDateKey] = useState(() => formatLocalDateKey(initialDate));
  const [timeHHMM, setTimeHHMM] = useState(() => formatLocalHHMM(initialDate));
  const [durationMinutes, setDurationMinutes] = useState(() => String(initialDuration));

  const [scheduleRow, setScheduleRow] = useState(null);
  const [otherBookings, setOtherBookings] = useState([]);
  const [loadingContext, setLoadingContext] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDateKey(formatLocalDateKey(initialDate));
    setTimeHHMM(formatLocalHHMM(initialDate));
    setDurationMinutes(String(initialDuration));
    setError(null);
  }, [initialDate, initialDuration, booking?.id]);

  // Загружаем расписание мастера на выбранную дату и другие активные записи на эту дату
  useEffect(() => {
    let active = true;

    async function loadDayAvailability() {
      if (!booking?.master_id || !dateKey) return;
      setLoadingContext(true);
      setError(null);

      try {
        const [{ data: schedData, error: schedErr }, { data: bookData, error: bookErr }] =
          await Promise.all([
            supabase
              .from('schedule')
              .select('id, date, start_time, end_time, is_available')
              .eq('master_id', booking.master_id)
              .eq('date', dateKey)
              .maybeSingle(),
            supabase
              .from('bookings')
              .select('id, slot_time, status, duration_minutes, services(duration_minutes)')
              .eq('master_id', booking.master_id)
              .neq('status', 'cancelled')
              .neq('id', booking.id),
          ]);

        if (schedErr) throw schedErr;
        if (bookErr) throw bookErr;

        if (!active) return;
        setScheduleRow(schedData || null);

        const sameDay = (bookData || []).filter((item) => {
          if (!item.slot_time) return false;
          const dt = new Date(item.slot_time);
          return !Number.isNaN(dt.getTime()) && formatLocalDateKey(dt) === dateKey;
        });
        setOtherBookings(sameDay);
      } catch (err) {
        if (!active) return;
        console.error('Ошибка проверки расписания при редактировании записи:', err.message);
        setError('Не удалось загрузить расписание и занятые интервалы мастера.');
      } finally {
        if (active) setLoadingContext(false);
      }
    }

    loadDayAvailability();
    return () => {
      active = false;
    };
  }, [booking?.master_id, booking?.id, dateKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const parsedDuration = Number(durationMinutes);
    if (!Number.isFinite(parsedDuration) || parsedDuration < 10 || parsedDuration > 600) {
      setError('Укажите корректную длительность от 10 до 600 минут.');
      return;
    }

    const startMins = parseTimeToMinutes(timeHHMM);
    if (startMins === null) {
      setError('Укажите корректное время начала (ЧЧ:ММ).');
      return;
    }

    const endMins = startMins + parsedDuration;

    if (scheduleRow) {
      if (!scheduleRow.is_available) {
        setError('Выбранный день отмечен у мастера как выходной.');
        return;
      }
      const shiftStart = parseTimeToMinutes(scheduleRow.start_time);
      const shiftEnd = parseTimeToMinutes(scheduleRow.end_time);
      if (shiftStart !== null && shiftEnd !== null) {
        if (startMins < shiftStart || endMins > shiftEnd) {
          setError(
            `Интервал ${timeHHMM}–${formatMinutesToHHMM(endMins)} выходит за рамки смены мастера (${formatMinutesToHHMM(shiftStart)}–${formatMinutesToHHMM(shiftEnd)}).`
          );
          return;
        }
      }
    }

    const conflicting = otherBookings.find((item) => {
      const dt = new Date(item.slot_time);
      if (Number.isNaN(dt.getTime())) return false;
      const bStart = dt.getHours() * 60 + dt.getMinutes();
      const bDur = resolveItemDurationMinutes(item);
      const bEnd = bStart + bDur;
      return startMins < bEnd && endMins > bStart;
    });

    if (conflicting) {
      const cStart = new Date(conflicting.slot_time);
      const cStartMins = cStart.getHours() * 60 + cStart.getMinutes();
      const cDur = resolveItemDurationMinutes(conflicting);
      setError(
        `Время пересекается с другой записью (${formatMinutesToHHMM(cStartMins)}–${formatMinutesToHHMM(cStartMins + cDur)}).`
      );
      return;
    }

    const nextIso = buildIsoFromLocalDateAndTime(dateKey, timeHHMM);
    if (!nextIso) {
      setError('Не удалось сформировать дату и время.');
      return;
    }

    setSaving(true);
    try {
      const updatePayload = {
        slot_time: nextIso,
        duration_minutes: parsedDuration,
      };

      let { data: updatedRow, error: updateError } = await supabase
        .from('bookings')
        .update(updatePayload)
        .eq('id', booking.id)
        .select('id, slot_time, status, duration_minutes')
        .single();

      if (updateError && /duration_minutes/i.test(updateError.message || '')) {
        const fallback = await supabase
          .from('bookings')
          .update({ slot_time: nextIso })
          .eq('id', booking.id)
          .select('id, slot_time, status')
          .single();
        updatedRow = fallback.data ? { ...fallback.data, duration_minutes: parsedDuration } : null;
        updateError = fallback.error;
      }

      if (updateError) throw updateError;

      if (typeof onSaved === 'function') {
        onSaved({
          ...booking,
          ...updatedRow,
          slot_time: nextIso,
          duration_minutes: parsedDuration,
        });
      }
    } catch (err) {
      console.error('Ошибка сохранения изменений записи:', err.message);
      setError('Не удалось сохранить изменения записи. Проверьте права доступа в БД.');
    } finally {
      setSaving(false);
    }
  };

  if (!booking) return null;

  const startMinsPreview = parseTimeToMinutes(timeHHMM);
  const durPreview = Number(durationMinutes);
  const validDurPreview = Number.isFinite(durPreview) && durPreview > 0;
  const endPreviewStr =
    startMinsPreview !== null && validDurPreview
      ? formatMinutesToHHMM(startMinsPreview + durPreview)
      : '—';

  const baseServiceDuration = Number(booking.services?.duration_minutes) || 0;
  const freedMinutesPreview =
    baseServiceDuration > 0 && validDurPreview && durPreview < baseServiceDuration
      ? baseServiceDuration - durPreview
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Изменение записи"
    >
      <div className="bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Изменить запись</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {booking.services?.title || 'Услуга'} ·{' '}
              {booking.client?.full_name || 'Клиент'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 text-sm font-semibold px-2 py-1 rounded-lg cursor-pointer"
          >
            ✕
          </button>
        </div>

        {loadingContext && (
          <p className="text-xs text-slate-500">Проверяем расписание и занятые слоты...</p>
        )}

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-xs font-medium"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Дата
            </label>
            <input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Время начала
              </label>
              <input
                type="time"
                value={timeHHMM}
                onChange={(e) => setTimeHHMM(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Длительность (мин)
              </label>
              <input
                type="number"
                min={10}
                max={600}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 space-y-1">
            <div>
              Итоговый интервал:{' '}
              <strong className="text-slate-900">
                {timeHHMM || '—'} — {endPreviewStr}
              </strong>
            </div>
            {freedMinutesPreview > 0 && (
              <div className="text-emerald-700 font-semibold">
                Освободится {freedMinutesPreview} мин относительно базовой услуги ({baseServiceDuration} мин) — слоты станут доступны.
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}