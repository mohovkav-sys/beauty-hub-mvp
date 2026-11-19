import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import './MasterSchedule.css';

// Названия дней недели начиная с понедельника для шапки календаря
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Названия месяцев для отображения текущего периода в заголовке календаря
const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

/**
 * Изолированные настройки визуального отображения кнопки «Применить» для каждого состояния.
 * Логика компонента выбирает только ключ состояния, а оформление задается здесь отдельно.
 */
// Словарь только с текстом кнопки для каждого логического состояния
const APPLY_BUTTON_LABELS = {
    disabled: 'Применить',
    active: 'Применить',
    'confirm-close': 'Всё равно применить выходной',
    saving: 'Применяем...',
  };

/**
 * Форматирует объект Date в строку 'YYYY-MM-DD' по локальному часовому поясу.
 * Используется для ключей словарей и запросов в Supabase (где колонка date имеет тип DATE).
 *
 * @param {Date} dateObj - Исходная дата
 * @returns {string} Строка вида 'YYYY-MM-DD'
 */
function formatLocalDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Переводит дату из внутреннего формата 'YYYY-MM-DD' в принятый в России формат 'ДД.ММ.ГГГГ'
 * для отображения пользователю в заголовках и уведомлениях.
 *
 * @param {string} dateKey - Строка даты вида 'YYYY-MM-DD'
 * @returns {string} Строка даты вида 'ДД.ММ.ГГГГ'
 */
function formatRussianDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  const [year, month, day] = parts;
  return `${day}.${month}.${year}`;
}

/**
 * Переводит строку времени ('09:00' или '09:00:00') в общее число минут от начала суток.
 * Упрощает сравнение интервалов смены и занятых записей клиентов.
 *
 * @param {string} timeStr - Строка времени
 * @returns {number|null} Количество минут от 00:00 либо null при некорректном вводе
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Переводит число минут от начала суток обратно в читаемый формат 'HH:MM'.
 *
 * @param {number} totalMinutes - Минуты от 00:00
 * @returns {string} Строка вида 'HH:MM'
 */
function formatMinutesToHHMM(totalMinutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
  const minutes = String(clamped % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Приводит время из базы данных ('09:00:00') к короткому виду ('09:00') для полей ввода и карточек.
 *
 * @param {string|null|undefined} timeStr - Время из БД
 * @param {string} fallback - Запасное значение, если в БД пусто
 * @returns {string} Строка вида 'HH:MM'
 */
function normalizeTimeInput(timeStr, fallback = '09:00') {
  if (!timeStr || typeof timeStr !== 'string') return fallback;
  return timeStr.slice(0, 5);
}

/**
 * Компонент календаря рабочих и выходных дней мастера в личном кабинете.
 * Показывает календарь выбранного месяца с цветными отметками статусов,
 * а по клику на день открывает окно настройки смены и список занятых интервалов.
 *
 * @param {Object} props
 * @param {Object} props.master - Профиль авторизованного мастера из таблицы `users`
 */
export default function MasterSchedule({ master }) {
  // Фиксируем сегодняшнюю дату, чтобы подсвечивать текущий день и строить календарь
  const today = useMemo(() => new Date(), []);

  // Выбранный для просмотра месяц (храним 1-е число этого месяца)
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );

  // Расписание мастера за месяц, сгруппированное по ключу даты 'YYYY-MM-DD'
  const [scheduleByDate, setScheduleByDate] = useState({});
  // Активные записи клиентов за месяц, сгруппированные по ключу даты 'YYYY-MM-DD'
  const [bookingsByDate, setBookingsByDate] = useState({});

  // Состояния загрузки, сохранения и сообщений для пользователя
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Дата дня, открытого сейчас во всплывающем окне ('YYYY-MM-DD' или null, если окно закрыто)
  const [selectedDateKey, setSelectedDateKey] = useState(null);

  // Исходный снимок состояния дня при открытии окна для проверки наличия изменений
  const [initialDaySnapshot, setInitialDaySnapshot] = useState({
    isWorkingDay: false,
    startTime: '09:00',
    endTime: '20:00',
  });

  // Текущие значения формы внутри окна выбранного дня
  const [isWorkingDay, setIsWorkingDay] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('20:00');
  // Флаг повторного подтверждения, если мастер закрывает день, где уже есть записи
  const [confirmWithBookings, setConfirmWithBookings] = useState(false);

  /**
   * Вычисляет границы текущего месяца для фильтрации запросов к Supabase.
   */
  const monthRange = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Захватываем ±1 день вокруг месяца, чтобы граничные записи не потерялись из-за часового пояса
    const prevDay = new Date(year, month, 0);
    const nextDay = new Date(year, month + 1, 1);

    return {
      startDateStr: formatLocalDateKey(firstDay),
      endDateStr: formatLocalDateKey(lastDay),
      bookingsFromIso: `${formatLocalDateKey(prevDay)}T00:00:00.000Z`,
      bookingsToIso: `${formatLocalDateKey(nextDay)}T23:59:59.999Z`,
    };
  }, [viewMonth]);

  /**
   * Загружает из Supabase расписание мастера (`schedule`) и записи клиентов (`bookings`)
   * за выбранный месяц, а затем раскладывает их по дням и считает занятые интервалы времени.
   */
  const fetchMonthData = useCallback(async () => {
    if (!master?.id) return;

    setLoading(true);
    setError(null);

    try {
      // Запрашиваем настройки рабочих/выходных дней мастера за отображаемый месяц
      const { data: scheduleRows, error: scheduleError } = await supabase
        .from('schedule')
        .select('id, master_id, date, start_time, end_time, is_available')
        .eq('master_id', master.id)
        .gte('date', monthRange.startDateStr)
        .lte('date', monthRange.endDateStr);

      if (scheduleError) throw scheduleError;

      // Запрашиваем записи мастера (кроме отмененных) и подтягиваем длительность услуги из `services`
      const { data: bookingRows, error: bookingsError } = await supabase
        .from('bookings')
        .select('id, master_id, service_id, slot_time, status, services(title, duration_minutes)')
        .eq('master_id', master.id)
        .neq('status', 'cancelled')
        .gte('slot_time', monthRange.bookingsFromIso)
        .lte('slot_time', monthRange.bookingsToIso);

      if (bookingsError) throw bookingsError;

      // Собираем быстрый словарь расписания: { '2026-11-20': { ...строка из schedule } }
      const nextScheduleMap = {};
      (scheduleRows || []).forEach((row) => {
        if (row.date) {
          nextScheduleMap[row.date] = row;
        }
      });

      // Группируем записи по локальной дате и вычисляем интервал [начало - конец] с учетом длительности
      const nextBookingsMap = {};
      (bookingRows || []).forEach((booking) => {
        if (!booking.slot_time) return;
        const slotDate = new Date(booking.slot_time);
        if (Number.isNaN(slotDate.getTime())) return;

        const dateKey = formatLocalDateKey(slotDate);
        const startMinutes = slotDate.getHours() * 60 + slotDate.getMinutes();
        const rawDuration = Number(booking.services?.duration_minutes);
        const durationMinutes = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60;
        const endMinutes = startMinutes + durationMinutes;

        const item = {
          id: booking.id,
          status: booking.status || 'confirmed',
          serviceTitle: booking.services?.title || 'Услуга',
          durationMinutes,
          startHHMM: formatMinutesToHHMM(startMinutes),
          endHHMM: formatMinutesToHHMM(endMinutes),
          startMinutes,
          endMinutes,
        };

        if (!nextBookingsMap[dateKey]) {
          nextBookingsMap[dateKey] = [];
        }
        nextBookingsMap[dateKey].push(item);
      });

      // Сортируем занятые интервалы внутри каждого дня по порядку от раннего к позднему
      Object.keys(nextBookingsMap).forEach((dateKey) => {
        nextBookingsMap[dateKey].sort((a, b) => a.startMinutes - b.startMinutes);
      });

      setScheduleByDate(nextScheduleMap);
      setBookingsByDate(nextBookingsMap);
    } catch (err) {
      console.error('Ошибка загрузки расписания мастера:', err.message);
      setError('Не удалось загрузить расписание или занятые часы. Проверьте соединение.');
    } finally {
      setLoading(false);
    }
  }, [master?.id, monthRange]);

  // Автоматически перезагружаем данные календаря при смене мастера или просматриваемого месяца
  useEffect(() => {
    fetchMonthData();
  }, [fetchMonthData]);

  /**
   * Собирает массив ячеек для сетки календаря: пустые ячейки в начале месяца
   * и карточки каждого календарного дня со статусом и количеством записей.
   */
  const calendarCells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // В JavaScript воскресенье имеет индекс 0, поэтому пересчитываем сдвиг так, чтобы неделя шла с Пн
    const leadingEmptyCount = (firstDayOfMonth.getDay() + 6) % 7;

    const cells = [];
    for (let i = 0; i < leadingEmptyCount; i += 1) {
      cells.push({ type: 'empty', key: `empty-${i}` });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateObj = new Date(year, month, day);
      const dateKey = formatLocalDateKey(dateObj);
      const scheduleItem = scheduleByDate[dateKey] || null;
      const dayBookings = bookingsByDate[dateKey] || [];
      const isWorking = Boolean(scheduleItem && scheduleItem.is_available);

      cells.push({
        type: 'day',
        key: dateKey,
        dateKey,
        dayNumber: day,
        isToday: dateKey === formatLocalDateKey(today),
        isWorking,
        scheduleItem,
        bookingsCount: dayBookings.length,
      });
    }

    return cells;
  }, [viewMonth, scheduleByDate, bookingsByDate, today]);

  /**
   * Проверяет, отличаются ли текущие значения формы в окне дня от исходного снимка.
   */
  const hasDayChanges = useMemo(() => {
    if (!selectedDateKey) return false;

    if (isWorkingDay !== initialDaySnapshot.isWorkingDay) {
      return true;
    }

    if (isWorkingDay) {
      return (
        startTime.slice(0, 5) !== initialDaySnapshot.startTime.slice(0, 5) ||
        endTime.slice(0, 5) !== initialDaySnapshot.endTime.slice(0, 5)
      );
    }

    return false;
  }, [selectedDateKey, isWorkingDay, startTime, endTime, initialDaySnapshot]);

  /**
   * Определяет логическое состояние кнопки «Применить» для выбора оформления из APPLY_BUTTON_UI_CONFIG.
   */
    /**
   * Открывает модальное окно для выбранного дня, заполняет поля текущими настройками
   * и сохраняет исходный снимок для отслеживания изменений.
   *
   * @param {Object} cell - Данные выбранной ячейки дня
   */
  const handleOpenDayModal = (cell) => {
    setError(null);
    setNotice(null);
    setConfirmWithBookings(false);
    setSelectedDateKey(cell.dateKey);

    if (cell.scheduleItem) {
      const working = Boolean(cell.scheduleItem.is_available);
      const start = normalizeTimeInput(cell.scheduleItem.start_time, '09:00');
      const end = normalizeTimeInput(cell.scheduleItem.end_time, '20:00');
      setIsWorkingDay(working);
      setStartTime(start);
      setEndTime(end);
      setInitialDaySnapshot({ isWorkingDay: working, startTime: start, endTime: end });
    } else {
      const defaultStart = '09:00';
      const defaultEnd = '20:00';
      setIsWorkingDay(false);
      setStartTime(defaultStart);
      setEndTime(defaultEnd);
      setInitialDaySnapshot({
        isWorkingDay: false,
        startTime: defaultStart,
        endTime: defaultEnd,
      });
    }
  };

  /**
   * Закрывает всплывающее окно настройки дня и сбрасывает флаг подтверждения.
   */
  const handleCloseModal = () => {
    if (saving) return;
    setSelectedDateKey(null);
    setConfirmWithBookings(false);
  };

  /**
   * Включает режим «Рабочий день» и подставляет готовый шаблон часов работы.
   *
   * @param {string} presetStart - Начало смены ('HH:MM')
   * @param {string} presetEnd - Окончание смены ('HH:MM')
   */
  const applyWorkingPreset = (presetStart, presetEnd) => {
    setIsWorkingDay(true);
    setStartTime(presetStart);
    setEndTime(presetEnd);
    setConfirmWithBookings(false);
    setError(null);
  };

  /**
   * Проверяет наличие изменений и корректность часов смены, защищает от случайного закрытия дня
   * с записями и сохраняет состояние дня (рабочий день или выходной) в таблицу `schedule`.
   *
   * @param {React.FormEvent} e - Событие отправки формы
   */
  const handleSaveDaySchedule = async (e) => {
    e.preventDefault();
    if (!selectedDateKey || !master?.id || !hasDayChanges) return;

    setError(null);
    setNotice(null);

    const dayBookings = bookingsByDate[selectedDateKey] || [];
    const startMins = parseTimeToMinutes(startTime);
    const endMins = parseTimeToMinutes(endTime);
    const formattedDateRu = formatRussianDate(selectedDateKey);

    if (isWorkingDay) {
      if (startMins === null || endMins === null) {
        setError('Укажите корректное время начала и окончания смены.');
        return;
      }
      if (endMins <= startMins) {
        setError('Время окончания смены должно быть позже времени начала.');
        return;
      }

      const outOfRangeBooking = dayBookings.find(
        (b) => b.startMinutes < startMins || b.endMinutes > endMins
      );
      if (outOfRangeBooking) {
        setError(
          `В этот день уже есть запись (${outOfRangeBooking.startHHMM}–${outOfRangeBooking.endHHMM}). Расширьте часы смены или сначала перенесите запись.`
        );
        return;
      }
    } else if (dayBookings.length > 0 && !confirmWithBookings) {
      setConfirmWithBookings(true);
      setError(
        `На ${formattedDateRu} уже есть активных записей: ${dayBookings.length} шт. Нажмите «Применить» еще раз, чтобы подтвердить выходной день (существующие записи останутся в базе).`
      );
      return;
    }

    setSaving(true);

    const normalizedStart = `${startTime.slice(0, 5)}:00`;
    const normalizedEnd = `${endTime.slice(0, 5)}:00`;

    try {
      const existingRow = scheduleByDate[selectedDateKey];

      if (existingRow?.id) {
        const { data, error: updateError } = await supabase
          .from('schedule')
          .update({
            start_time: normalizedStart,
            end_time: normalizedEnd,
            is_available: isWorkingDay,
          })
          .eq('id', existingRow.id)
          .eq('master_id', master.id)
          .select('id, master_id, date, start_time, end_time, is_available')
          .single();

        if (updateError) throw updateError;

        setScheduleByDate((prev) => ({
          ...prev,
          [selectedDateKey]: data,
        }));
      } else {
        const { data, error: insertError } = await supabase
          .from('schedule')
          .insert([
            {
              master_id: master.id,
              date: selectedDateKey,
              start_time: normalizedStart,
              end_time: normalizedEnd,
              is_available: isWorkingDay,
            },
          ])
          .select('id, master_id, date, start_time, end_time, is_available')
          .single();

        if (insertError) throw insertError;

        setScheduleByDate((prev) => ({
          ...prev,
          [selectedDateKey]: data,
        }));
      }

      setNotice(
        isWorkingDay
          ? `Дата ${formattedDateRu} отмечена как рабочий день (${startTime.slice(0, 5)}–${endTime.slice(0, 5)}).`
          : `Дата ${formattedDateRu} отмечена как выходной.`
      );
      setSelectedDateKey(null);
      setConfirmWithBookings(false);
    } catch (err) {
      console.error('Ошибка сохранения расписания дня:', err.message);
      setError('Не удалось сохранить расписание на выбранный день. Проверьте права доступа.');
    } finally {
      setSaving(false);
    }
  };

  // Занятые интервалы клиентов для активного модального окна
 
 const selectedDayBookings = selectedDateKey ? bookingsByDate[selectedDateKey] || [] : [];

 // Вычисление ключа логического состояния кнопки «Применить»
 const applyButtonStateKey = useMemo(() => {
   if (saving) return 'saving';
   if (!hasDayChanges) return 'disabled';
   if (!isWorkingDay && confirmWithBookings) return 'confirm-close';
   return 'active';
 }, [saving, hasDayChanges, isWorkingDay, confirmWithBookings]);

 const isApplyDisabled = applyButtonStateKey === 'disabled' || applyButtonStateKey === 'saving';

  return (
    <section className="bg-white text-slate-900 rounded-2xl shadow-md border border-beauty-light p-6 text-left">
      {/* Шапка календаря с переключением месяцев */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <h3 className="text-xl font-bold text-beauty-dark">Календарь рабочих дней</h3>
          <p className="text-sm text-slate-600 mt-1">
            Нажмите на нужный день, чтобы отметить рабочий день, выходной или посмотреть занятые часы.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
            }
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-800 cursor-pointer"
          >
            ← Пред.
          </button>
          <span className="min-w-[140px] text-center font-bold text-beauty-dark">
            {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </span>
          <button
            type="button"
            onClick={() =>
              setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
            }
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-800 cursor-pointer"
          >
            След. →
          </button>
        </div>
      </div>

      {/* Пояснение цветовых обозначений на календаре */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700 mb-4 pb-3 border-b border-slate-100">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          Рабочий день
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-slate-300 inline-block" />
          Выходной / не задан
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-beauty-accent inline-block" />
          Есть записи клиентов
        </span>
      </div>

      {/* Уведомления об успехе и ошибках вне модального окна */}
      {notice && (
        <div
          role="status"
          className="mb-4 p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-xl text-sm font-medium"
        >
          {notice}
        </div>
      )}

      {error && !selectedDateKey && (
        <div
          role="alert"
          className="mb-4 p-3.5 bg-red-50 border border-red-300 text-red-800 rounded-xl text-sm font-medium"
        >
          {error}
        </div>
      )}

      {/* Основная сетка дней месяца */}
      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Загружаем календарь расписания...</p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="text-center text-xs font-bold text-slate-500 uppercase py-1"
            >
              {label}
            </div>
          ))}

          {calendarCells.map((cell) => {
            if (cell.type === 'empty') {
              return <div key={cell.key} className="h-20 sm:h-24 rounded-xl bg-transparent" />;
            }

            const cardClasses = cell.isWorking
              ? 'bg-emerald-50/80 border-emerald-300 hover:border-emerald-500 text-slate-900'
              : 'bg-slate-50 border-slate-200 hover:border-slate-400 text-slate-600';

            const shiftLabel = cell.isWorking
              ? `${normalizeTimeInput(cell.scheduleItem?.start_time, '09:00')}–${normalizeTimeInput(
                  cell.scheduleItem?.end_time,
                  '20:00'
                )}`
              : 'Выходной';

            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => handleOpenDayModal(cell)}
                className={`h-20 sm:h-24 p-2 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${cardClasses} ${
                  cell.isToday ? 'ring-2 ring-beauty-dark' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-sm font-bold ${
                      cell.isWorking ? 'text-emerald-950' : 'text-slate-700'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {cell.bookingsCount > 0 && (
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-beauty-accent text-white">
                      {cell.bookingsCount} зап.
                    </span>
                  )}
                </div>

                <span
                  className={`text-[11px] font-medium truncate ${
                    cell.isWorking ? 'text-emerald-800' : 'text-slate-500'
                  }`}
                >
                  {shiftLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Всплывающее окно настройки дня и просмотра занятых окон */}
      {selectedDateKey && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="day-schedule-modal-title"
        >
          <div className="bg-white text-slate-900 w-full max-w-lg rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 id="day-schedule-modal-title" className="text-lg font-bold text-beauty-dark">
                  Настройка дня: {formatRussianDate(selectedDateKey)}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Отметьте рабочий день с часами смены либо выходной день.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={saving}
                className="text-slate-500 hover:text-slate-800 text-sm font-bold px-2 py-1 rounded-lg cursor-pointer"
                aria-label="Закрыть окно"
              >
                ✕
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-300 text-red-800 rounded-xl text-xs font-medium"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSaveDaySchedule} className="space-y-4">
              {/* Переключатель статуса дня: Рабочий день / Выходной */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkingDay(true);
                    setConfirmWithBookings(false);
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm font-semibold transition cursor-pointer ${
                    isWorkingDay
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white/60'
                  }`}
                >
                  Рабочий день
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkingDay(false);
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-lg text-sm font-semibold transition cursor-pointer ${
                    !isWorkingDay
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white/60'
                  }`}
                >
                  Выходной
                </button>
              </div>

              {/* Поля часов смены и быстрые пресеты (показываются для рабочего дня) */}
              {isWorkingDay && (
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-950">Часы работы смены</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyWorkingPreset('09:00', '20:00')}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                      >
                        09:00–20:00
                      </button>
                      <button
                        type="button"
                        onClick={() => applyWorkingPreset('10:00', '19:00')}
                        className="text-[11px] font-semibold px-2 py-1 rounded-md bg-white border border-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                      >
                        10:00–19:00
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Начало смены
                      </label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Окончание смены
                      </label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Список занятых временных окон на выбранную дату */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Занятое время в этот день ({selectedDayBookings.length})
                </h5>

                {selectedDayBookings.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    На эту дату пока нет забронированных окон — всё время смены свободно.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {selectedDayBookings.map((booking) => (
                      <li
                        key={booking.id}
                        className="flex items-center justify-between gap-2 text-xs bg-white px-3 py-2 rounded-lg border border-slate-200"
                      >
                        <span className="font-bold text-beauty-accent">
                          {booking.startHHMM} – {booking.endHHMM}
                        </span>
                        <span className="text-slate-700 truncate">
                          {booking.serviceTitle} ({booking.durationMinutes} мин)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Нижняя панель действий: визуальные состояния кнопки заданы в MasterSchedule.css */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  disabled={saving}
                  className="shrink-0 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isApplyDisabled}
                  data-apply-state={applyButtonStateKey}
                  className="master-schedule-apply-btn"
                >
                  {APPLY_BUTTON_LABELS[applyButtonStateKey]}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}