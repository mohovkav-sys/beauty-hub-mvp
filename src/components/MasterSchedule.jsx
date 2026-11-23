import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from "../lib/supabase";
import {
  buildDayTimeSlots,
  buildMonthCalendarData,
  findDayScheduleConflict,
  formatLocalDateKey,
  formatRuShortDate,
  HOUR_PRESETS,
  MONTH_NAMES,
  normalizeTimeHHMM,
  WEEKDAY_LABELS,
} from '../utils/masterScheduleHelpers.js';

function groupRowsByDate(rows = [], dateExtractor) {
  return rows.reduce((acc, row) => {
    const key = dateExtractor(row);
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

export default function MasterSchedule({
  master = null,
  scheduleByDate: externalScheduleByDate,
  bookingsByDate: externalBookingsByDate,
  onSaveDays: externalOnSaveDays,
  slotStepMinutes = 30,
  rangeStart = '09:00',
  rangeEnd = '20:00',
}) {
  const masterId = master?.id || master?.master_id || null;

  const [internalScheduleByDate, setInternalScheduleByDate] = useState({});
  const [internalBookingsByDate, setInternalBookingsByDate] = useState({});
  const [loadingData, setLoadingData] = useState(false);

  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Подгружаем расписание и записи из Supabase, если пропсы не переданы напрямую родителем
  const fetchMasterScheduleData = useCallback(async () => {
    if (!masterId || (externalScheduleByDate && externalBookingsByDate)) return;
    setLoadingData(true);
    try {
      const [scheduleRes, bookingsRes] = await Promise.all([
        supabase.from('schedule').select('*').eq('master_id', masterId),
        supabase
          .from('bookings')
          .select('id, client_id, master_id, service_id, slot_time, status, services(title, duration_minutes)')
          .eq('master_id', masterId)
          .neq('status', 'cancelled'),
      ]);

      if (!scheduleRes.error && Array.isArray(scheduleRes.data)) {
        const nextSchedule = {};
        for (const item of scheduleRes.data) {
          if (item?.date) nextSchedule[item.date] = item;
        }
        setInternalScheduleByDate(nextSchedule);
      }

      if (!bookingsRes.error && Array.isArray(bookingsRes.data)) {
        const grouped = groupRowsByDate(bookingsRes.data, (b) => {
          if (!b?.slot_time) return '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(b.slot_time)) return b.slot_time;
          const parsed = new Date(b.slot_time);
          return Number.isNaN(parsed.getTime()) ? b.slot_time.slice(0, 10) : formatLocalDateKey(parsed);
        });
        setInternalBookingsByDate(grouped);
      }
    } finally {
      setLoadingData(false);
    }
  }, [masterId, externalScheduleByDate, externalBookingsByDate]);

  useEffect(() => {
    fetchMasterScheduleData();
  }, [fetchMasterScheduleData]);

  const scheduleByDate = externalScheduleByDate || internalScheduleByDate;
  const bookingsByDate = externalBookingsByDate || internalBookingsByDate;

  const defaultSaveDays = useCallback(
    async (daysPayload) => {
      if (!masterId) {
        throw new Error('Не определён идентификатор мастера для сохранения расписания');
      }
      const rows = daysPayload.map((d) => ({
        master_id: masterId,
        date: d.date,
        is_available: Boolean(d.is_available),
        start_time: d.is_available ? d.start_time : null,
        end_time: d.is_available ? d.end_time : null,
      }));

      const { data, error } = await supabase
        .from('schedule')
        .upsert(rows, { onConflict: 'master_id,date' })
        .select();

      if (error) throw error;

      setInternalScheduleByDate((prev) => {
        const next = { ...prev };
        const savedRows = Array.isArray(data) && data.length ? data : rows;
        for (const r of savedRows) {
          if (r?.date) next[r.date] = r;
        }
        return next;
      });
    },
    [masterId]
  );

  const handleSaveDays = externalOnSaveDays || defaultSaveDays;

  const { cells, weeks, todayKey } = useMemo(
    () => buildMonthCalendarData(viewMonth, scheduleByDate, bookingsByDate),
    [viewMonth, scheduleByDate, bookingsByDate]
  );

  const firstMonthDayKey = useMemo(() => {
    const firstDayCell = cells.find((c) => c.type === 'day');
    return firstDayCell ? firstDayCell.dateKey : '';
  }, [cells]);

  const [selectedDateKey, setSelectedDateKey] = useState(() => todayKey || '');
  const [isWorkingDay, setIsWorkingDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('20:00');
  const [selectedSlotTime, setSelectedSlotTime] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const [quickToolsOpen, setQuickToolsOpen] = useState(false);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const [weekStartTime, setWeekStartTime] = useState('09:00');
  const [weekEndTime, setWeekEndTime] = useState('20:00');
  const [confirmWeekClose, setConfirmWeekClose] = useState(false);

  useEffect(() => {
    const existsInMonth = cells.some((c) => c.type === 'day' && c.dateKey === selectedDateKey);
    if (!existsInMonth && firstMonthDayKey) {
      setSelectedDateKey(firstMonthDayKey);
    }
  }, [cells, firstMonthDayKey, selectedDateKey]);

  useEffect(() => {
    if (!selectedDateKey) return;
    const item = scheduleByDate[selectedDateKey] || null;
    const dayCell = cells.find((c) => c.type === 'day' && c.dateKey === selectedDateKey);

    const working =
      item && typeof item.is_available === 'boolean'
        ? Boolean(item.is_available)
        : Boolean(dayCell?.isWorking);

    setIsWorkingDay(working);
    setStartTime(normalizeTimeHHMM(item?.start_time, '09:00'));
    setEndTime(normalizeTimeHHMM(item?.end_time, '20:00'));
    setSelectedSlotTime('');
    setConfirmClose(false);
    setConfirmWeekClose(false);
    setStatusMessage(null);

    if (dayCell && typeof dayCell.weekIndex === 'number') {
      setSelectedWeekIndex(dayCell.weekIndex);
    }
  }, [selectedDateKey, scheduleByDate, cells]);

  const activeWeekObj = weeks[selectedWeekIndex] || weeks[0] || null;

  const highlightedWeekKeys = useMemo(() => {
    if (!activeWeekObj) return new Set();
    return new Set(activeWeekObj.dateKeys);
  }, [activeWeekObj]);

  const selectedDayBookings = useMemo(
    () => bookingsByDate[selectedDateKey] || [],
    [bookingsByDate, selectedDateKey]
  );

  const timeSlots = useMemo(
    () =>
      buildDayTimeSlots({
        startTime,
        endTime,
        isWorkingDay,
        dayBookings: selectedDayBookings,
        stepMinutes: slotStepMinutes,
        rangeStart,
        rangeEnd,
      }),
    [startTime, endTime, isWorkingDay, selectedDayBookings, slotStepMinutes, rangeStart, rangeEnd]
  );

  const dayConflict = useMemo(
    () =>
      findDayScheduleConflict({
        isWorkingDay,
        startTime,
        endTime,
        dayBookings: selectedDayBookings,
      }),
    [isWorkingDay, startTime, endTime, selectedDayBookings]
  );

  const handleSelectSlot = (slot) => {
    if (slot.disabled || saving) return;
    setSelectedSlotTime((prev) => (prev === slot.time ? '' : slot.time));
    setStatusMessage(null);
  };

  const handleApplyPresetToDay = (preset) => {
    setIsWorkingDay(true);
    setStartTime(preset.start);
    setEndTime(preset.end);
    setConfirmClose(false);
    setStatusMessage(null);
  };

  const handleSaveSelectedDay = async () => {
    if (!selectedDateKey || saving) return;

    if (dayConflict?.type === 'invalid_range' || dayConflict?.type === 'outside_shift') {
      setStatusMessage({ type: 'err', text: dayConflict.message });
      return;
    }

    if (dayConflict?.type === 'close_with_bookings' && !confirmClose) {
      setConfirmClose(true);
      setStatusMessage({ type: 'warn', text: dayConflict.message });
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      await handleSaveDays([
        {
          date: selectedDateKey,
          is_available: isWorkingDay,
          start_time: isWorkingDay ? startTime : null,
          end_time: isWorkingDay ? endTime : null,
        },
      ]);
      setConfirmClose(false);
      setStatusMessage({
        type: 'ok',
        text: isWorkingDay
          ? `Смена ${formatRuShortDate(selectedDateKey)} (${startTime}–${endTime}) сохранена`
          : `${formatRuShortDate(selectedDateKey)} отмечен как выходной`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'err',
        text: err?.message || 'Не удалось сохранить расписание дня',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyWeekSchedule = async (makeWorking) => {
    if (!activeWeekObj || saving) return;

    const weekBookingsCount = activeWeekObj.dateKeys.reduce(
      (acc, key) => acc + (bookingsByDate[key]?.length || 0),
      0
    );

    if (makeWorking) {
      for (const dateKey of activeWeekObj.dateKeys) {
        const conflict = findDayScheduleConflict({
          isWorkingDay: true,
          startTime: weekStartTime,
          endTime: weekEndTime,
          dayBookings: bookingsByDate[dateKey] || [],
        });
        if (conflict) {
          setStatusMessage({
            type: 'err',
            text: `${formatRuShortDate(dateKey)}: ${conflict.message}`,
          });
          return;
        }
      }
    } else if (weekBookingsCount > 0 && !confirmWeekClose) {
      setConfirmWeekClose(true);
      setStatusMessage({
        type: 'warn',
        text: `На выбранной неделе есть записей: ${weekBookingsCount}. Нажмите ещё раз, чтобы закрыть неделю как выходную (записи останутся в базе).`,
      });
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      const payload = activeWeekObj.dateKeys.map((dateKey) => ({
        date: dateKey,
        is_available: makeWorking,
        start_time: makeWorking ? weekStartTime : null,
        end_time: makeWorking ? weekEndTime : null,
      }));
      await handleSaveDays(payload);
      setConfirmWeekClose(false);
      setStatusMessage({
        type: 'ok',
        text: makeWorking
          ? `${activeWeekObj.label}: задана смена ${weekStartTime}–${weekEndTime}`
          : `${activeWeekObj.label}: отмечена выходной`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'err',
        text: err?.message || 'Не удалось обновить расписание недели',
      });
    } finally {
      setSaving(false);
    }
  };

  const summaryText = useMemo(() => {
    if (loadingData) return 'Загрузка графика...';
    if (!selectedDateKey) return 'Выберите день в календаре';
    const dateLabel = formatRuShortDate(selectedDateKey);
    if (!isWorkingDay) {
      return `${dateLabel} — выходной день`;
    }
    if (selectedSlotTime) {
      return `${dateLabel}, слот ${selectedSlotTime} · смена ${startTime}–${endTime}`;
    }
    return `${dateLabel} · смена ${startTime}–${endTime}`;
  }, [loadingData, selectedDateKey, isWorkingDay, selectedSlotTime, startTime, endTime]);

  return (
    <section className="w-full max-w-4xl bg-white text-slate-900 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Компактная панель быстрых действий по шаблонам часов и неделе */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-slate-500 mr-1">Шаблоны смены:</span>
          {HOUR_PRESETS.map((preset) => {
            const active = isWorkingDay && startTime === preset.start && endTime === preset.end;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPresetToDay(preset)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setQuickToolsOpen((v) => !v);
            setConfirmWeekClose(false);
          }}
          className="text-xs font-semibold text-teal-700 hover:text-teal-800 px-2.5 py-1 rounded hover:bg-teal-50 transition cursor-pointer"
        >
          {quickToolsOpen ? 'Скрыть неделю' : 'Настройки недели'}
        </button>
      </div>

      {quickToolsOpen && (
        <div className="px-4 py-3 bg-teal-50/50 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Выбор недели месяца"
            value={selectedWeekIndex}
            onChange={(e) => {
              setSelectedWeekIndex(Number(e.target.value));
              setConfirmWeekClose(false);
            }}
            className="h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium"
          >
            {weeks.map((w) => (
              <option key={w.index} value={w.index}>
                {w.label}
              </option>
            ))}
          </select>

          <input
            type="time"
            aria-label="Начало смены недели"
            value={weekStartTime}
            onChange={(e) => setWeekStartTime(normalizeTimeHHMM(e.target.value, '09:00'))}
            className="h-9 px-2 rounded-lg border border-slate-300 bg-white text-slate-800"
          />
          <span className="text-slate-400">—</span>
          <input
            type="time"
            aria-label="Конец смены недели"
            value={weekEndTime}
            onChange={(e) => setWeekEndTime(normalizeTimeHHMM(e.target.value, '20:00'))}
            className="h-9 px-2 rounded-lg border border-slate-300 bg-white text-slate-800"
          />

          <button
            type="button"
            disabled={saving}
            onClick={() => handleApplyWeekSchedule(true)}
            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold transition cursor-pointer"
          >
            Неделя рабочая
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleApplyWeekSchedule(false)}
            className={`h-9 px-3 rounded-lg font-semibold transition cursor-pointer ${
              confirmWeekClose
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
            }`}
          >
            {confirmWeekClose ? 'Подтвердить выходную' : 'Неделя выходная'}
          </button>
        </div>
      )}

      {/* Двухколоночная композиция: слева месяц, справа управление днём и слоты */}
      <div className="flex flex-col md:grid md:grid-cols-12">
        <div className="md:col-span-5 p-4 sm:p-5 border-b md:border-b-0 md:border-r border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              onClick={() =>
                setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-lg transition cursor-pointer"
            >
              &lt;
            </button>
            <h3 className="text-base font-semibold text-slate-800 select-none">
              {MONTH_NAMES[viewMonth.getMonth()]}
            </h3>
            <button
              type="button"
              aria-label="Следующий месяц"
              onClick={() =>
                setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
              className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 text-lg transition cursor-pointer"
            >
              &gt;
            </button>
          </div>

          <div className="grid grid-cols-7 text-center mb-1.5">
            {WEEKDAY_LABELS.map((label, idx) => (
              <div
                key={label}
                className={`text-[11px] font-medium py-1 ${
                  idx >= 5 ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center">
            {cells.map((cell) => {
              if (cell.type === 'empty') {
                return <div key={cell.key} className="h-10 sm:h-9" />;
              }

              const isSelected = cell.dateKey === selectedDateKey;
              const isWeekHighlighted = !isSelected && highlightedWeekKeys.has(cell.dateKey);
              const isWeekendStyle = !cell.isWorking || cell.isCalendarWeekend;

              let dayClasses =
                'relative mx-auto w-10 h-10 sm:w-9 sm:h-9 rounded-md text-sm font-medium flex flex-col items-center justify-center transition select-none cursor-pointer ';

              if (isSelected) {
                dayClasses += 'bg-teal-600 text-white font-semibold shadow-xs';
              } else if (isWeekHighlighted) {
                dayClasses += 'bg-teal-100/80 text-teal-900 hover:bg-teal-100';
              } else if (isWeekendStyle) {
                dayClasses += 'bg-slate-100/80 text-slate-500 hover:bg-slate-200/70';
              } else {
                dayClasses += 'text-slate-800 hover:bg-slate-100';
              }

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDateKey(cell.dateKey)}
                  className={dayClasses}
                >
                  <span>{cell.dayNumber}</span>
                  {cell.bookingsCount > 0 && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                        isSelected ? 'bg-white' : 'bg-teal-600'
                      }`}
                      title={`Записей: ${cell.bookingsCount}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-7 p-4 sm:p-5 flex flex-col justify-between gap-4 min-w-0">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-sm text-slate-700 font-medium min-w-0">
                <span>График на {formatRuShortDate(selectedDateKey)}: </span>
                <span
                  className={
                    isWorkingDay ? 'text-emerald-700 font-semibold' : 'text-slate-500 font-semibold'
                  }
                >
                  {isWorkingDay ? `рабочий день (${startTime}–${endTime})` : 'выходной'}
                </span>
                {selectedDayBookings.length > 0 && (
                  <span className="ml-2 text-xs text-teal-700 font-medium">
                    · записей: {selectedDayBookings.length}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsWorkingDay((prev) => !prev);
                  setConfirmClose(false);
                  setStatusMessage(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition cursor-pointer ${
                  isWorkingDay
                    ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    : 'border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                {isWorkingDay ? 'Сделать выходным' : 'Сделать рабочим'}
              </button>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
              {timeSlots.map((slot) => {
                const isSelectedSlot = selectedSlotTime === slot.time && !slot.disabled;
                let slotClass =
                  'h-11 sm:h-10 rounded-md border text-sm font-medium flex items-center justify-center transition select-none ';

                if (slot.disabled) {
                  slotClass +=
                    'bg-slate-100/90 border-slate-100 text-slate-300 cursor-not-allowed';
                } else if (isSelectedSlot) {
                  slotClass +=
                    'bg-teal-600 border-teal-600 text-white font-semibold cursor-pointer';
                } else {
                  slotClass +=
                    'bg-white border-slate-200 text-slate-700 hover:border-teal-500 hover:text-teal-700 cursor-pointer';
                }

                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={slot.disabled}
                    onClick={() => handleSelectSlot(slot)}
                    title={
                      slot.isBooked
                        ? `Занято: ${slot.bookingTitle}`
                        : !isWorkingDay
                        ? 'Выходной день'
                        : `Слот ${slot.time}`
                    }
                    className={slotClass}
                  >
                    {slot.time}
                  </button>
                );
              })}
            </div>

            {statusMessage && (
              <div
                role={statusMessage.type === 'err' ? 'alert' : 'status'}
                className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                  statusMessage.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : statusMessage.type === 'warn'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {statusMessage.text}
              </div>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="flex-1 min-h-[42px] px-3.5 py-2 rounded-md bg-teal-100/80 text-teal-900 text-xs sm:text-sm font-medium flex items-center">
              <span className="truncate">{summaryText}</span>
            </div>

            <button
              type="button"
              disabled={saving || !selectedDateKey}
              onClick={handleSaveSelectedDay}
              className={`h-[42px] px-5 rounded-md text-sm font-semibold text-white shrink-0 transition cursor-pointer disabled:opacity-50 ${
                confirmClose ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-700 hover:bg-blue-800'
              }`}
            >
              {saving ? 'Сохранение...' : confirmClose ? 'Подтвердить' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}