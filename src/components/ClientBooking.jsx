import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
// Подключаем вынесенные стили горизонтального степпера онбординга
import './ClientBooking.css';

// Шаг сетки доступного времени внутри рабочей смены мастера (в минутах)
const SLOT_STEP_MINUTES = 30;

// Конфигурация 3 шагов пошагового онбординга записи клиента
const ONBOARDING_STEPS = [
  { id: 1, title: 'Мастер', subtitle: 'Выберите специалиста' },
  { id: 2, title: 'Услуга', subtitle: 'Выберите процедуру' },
  { id: 3, title: 'Дата и время', subtitle: 'Подберите свободный слот' },
];

/**
 * Переводит объект Date в локальный строковый ключ 'YYYY-MM-DD' без сдвига часового пояса по UTC.
 * Используется для точного сопоставления с колонкой `date` в таблице `schedule`.
 *
 * @param {Date} dateObj - Объект даты JavaScript
 * @returns {string} Строка даты вида '2026-11-20'
 */
function formatLocalDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Конвертирует технический ключ даты 'YYYY-MM-DD' в российский формат 'ДД.ММ.ГГГГ' для интерфейса.
 *
 * @param {string} dateKey - Дата в формате 'YYYY-MM-DD'
 * @returns {string} Дата в формате 'ДД.ММ.ГГГГ'
 */
function formatRussianDate(dateKey) {
  if (!dateKey || typeof dateKey !== 'string') return '';
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  const [year, month, day] = parts;
  return `${day}.${month}.${year}`;
}

/**
 * Переводит строковое время смены ('09:00' или '09:00:00') в количество минут от начала суток (00:00).
 * Упрощает сравнение интервалов и расчёт свободных окон.
 *
 * @param {string} timeStr - Время в формате 'HH:MM' или 'HH:MM:SS'
 * @returns {number|null} Количество минут от полуночи или null при некорректной строке
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
 * Переводит количество минут от начала суток обратно в читаемую строку 'HH:MM'.
 *
 * @param {number} totalMinutes - Количество минут от полуночи
 * @returns {string} Строка времени вида '14:30'
 */
function formatMinutesToHHMM(totalMinutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
  const minutes = String(clamped % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Собирает локальную дату ('YYYY-MM-DD') и локальное время ('HH:MM') в строку формата ISO 8601
 * для записи в колонку `slot_time` (timestamp with time zone) таблицы `bookings` в Supabase.
 *
 * @param {string} dateKey - Локальная дата 'YYYY-MM-DD'
 * @param {string} hhmm - Локальное время 'HH:MM'
 * @returns {string|null} Валидная ISO-строка или null при ошибке разбора
 */
function buildSlotIsoFromLocalDateAndTime(dateKey, hhmm) {
  if (!dateKey || !hhmm) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = hhmm.split(':').map(Number);
  if ([year, month, day, hours, minutes].some((val) => Number.isNaN(val))) {
    return null;
  }
  const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate.toISOString();
}

/**
 * Определяет фактическую длительность записи в минутах с приоритетом
 * индивидуальной длительности самой записи (`booking.duration_minutes`),
 * затем длительности услуги (`booking.services.duration_minutes`), иначе 60 мин.
 *
 * @param {Object} booking
 * @returns {number}
 */
function resolveBookingDurationMinutes(booking) {
  const rawCustomDuration = Number(booking?.duration_minutes);
  if (Number.isFinite(rawCustomDuration) && rawCustomDuration > 0) {
    return rawCustomDuration;
  }

  const rawServiceDuration = Number(booking?.services?.duration_minutes);
  if (Number.isFinite(rawServiceDuration) && rawServiceDuration > 0) {
    return rawServiceDuration;
  }

  return 60;
}

/**
 * Компонент пошагового онбординга онлайн-записи клиента:
 * Шаг 1: Выбор мастера
 * Шаг 2: Выбор услуги выбранного мастера
 * Шаг 3: Выбор рабочей даты (ДД.ММ.ГГГГ), свободного слота и подтверждение бронирования
 *
 * @param {Object} props - Свойства компонента
 * @param {Object} props.client - Профиль авторизованного клиента из таблицы `users`
 * @param {Function} [props.onBookingCreated] - Колбэк после успешного создания записи
 * @param {number} [props.refreshKey=0] - Счётчик для принудительного обновления доступности
 */
export default function ClientBooking({ client, onBookingCreated, refreshKey = 0 }) {
  // Номер активного шага онбординга (1 — Мастер, 2 — Услуга, 3 — Дата и время)
  const [currentStep, setCurrentStep] = useState(1);

  // Списки данных, загружаемые из Supabase
  const [masters, setMasters] = useState([]);
  const [masterServices, setMasterServices] = useState([]);
  const [masterScheduleRows, setMasterScheduleRows] = useState([]);
  const [masterBusyIntervalsByDate, setMasterBusyIntervalsByDate] = useState({});

  // Состояние выбранных клиентом параметров записи
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedDateKey, setSelectedDateKey] = useState('');
  const [selectedSlotHHMM, setSelectedSlotHHMM] = useState('');

  // Флаги загрузки, отправки и сообщения пользователю
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  /**
   * Загружает список всех специалистов с ролью 'master' из таблицы `users` для Шага 1.
   */
  const fetchMasters = useCallback(async () => {
    setLoadingMasters(true);
    setError(null);

    try {
      const { data, error: mastersError } = await supabase
        .from('users')
        .select('id, full_name, phone, role')
        .eq('role', 'master')
        .order('full_name', { ascending: true });

      if (mastersError) throw mastersError;
      setMasters(data || []);
    } catch (err) {
      console.error('Ошибка загрузки списка мастеров:', err.message);
      setError('Не удалось загрузить список мастеров. Проверьте подключение.');
    } finally {
      setLoadingMasters(false);
    }
  }, []);

  // Запускаем первичную загрузку мастеров при монтировании компонента
  useEffect(() => {
    fetchMasters();
  }, [fetchMasters]);

  /**
   * Загружает список услуг конкретного мастера из таблицы `services` для Шага 2.
   *
   * @param {string} masterId - UUID выбранного мастера
   */
  const fetchServicesForMaster = useCallback(async (masterId) => {
    if (!masterId) {
      setMasterServices([]);
      return;
    }

    setLoadingServices(true);
    setError(null);

    try {
      const { data, error: servicesError } = await supabase
        .from('services')
        .select('*')
        .eq('master_id', masterId)
        .order('title', { ascending: true });

      if (servicesError) throw servicesError;

      // Отфильтровываем скрытые услуги, если в схеме таблицы используется флаг is_active
      const visibleServices = (data || []).filter((item) => item.is_active !== false);
      setMasterServices(visibleServices);
    } catch (err) {
      console.error('Ошибка загрузки услуг мастера:', err.message);
      setError('Не удалось загрузить услуги выбранного мастера.');
    } finally {
      setLoadingServices(false);
    }
  }, []);

  // Подгружаем услуги каждый раз при смене выбранного мастера
  useEffect(() => {
    if (selectedMasterId) {
      fetchServicesForMaster(selectedMasterId);
    } else {
      setMasterServices([]);
    }
  }, [selectedMasterId, fetchServicesForMaster]);

  /**
   * Загружает рабочие смены мастера из `schedule` и активные записи из `bookings` для Шага 3,
   * формируя карту занятых временных интервалов по дням с учётом индивидуальной длительности.
   *
   * @param {string} masterId - UUID выбранного мастера
   */
  const fetchMasterAvailability = useCallback(async (masterId) => {
    if (!masterId) {
      setMasterScheduleRows([]);
      setMasterBusyIntervalsByDate({});
      return;
    }

    setLoadingAvailability(true);
    setError(null);

    const now = new Date();
    const todayKey = formatLocalDateKey(now);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const fromIso = `${formatLocalDateKey(yesterday)}T00:00:00.000Z`;

    try {
      const [
        { data: scheduleRows, error: scheduleError },
        { data: bookingRows, error: bookingsError },
      ] = await Promise.all([
        supabase
          .from('schedule')
          .select('id, master_id, date, start_time, end_time, is_available')
          .eq('master_id', masterId)
          .eq('is_available', true)
          .gte('date', todayKey)
          .order('date', { ascending: true }),
        supabase
          .from('bookings')
          .select('id, master_id, slot_time, status, duration_minutes, services(duration_minutes)')
          .eq('master_id', masterId)
          .neq('status', 'cancelled')
          .gte('slot_time', fromIso),
      ]);

      if (scheduleError) throw scheduleError;
      if (bookingsError) throw bookingsError;

      setMasterScheduleRows(scheduleRows || []);

      // Группируем занятые интервалы [startMins, endMins] по ключу локальной даты
      const busyMap = {};
      (bookingRows || []).forEach((booking) => {
        if (!booking.slot_time) return;
        const slotDate = new Date(booking.slot_time);
        if (Number.isNaN(slotDate.getTime())) return;

        const dateKey = formatLocalDateKey(slotDate);
        const startMins = slotDate.getHours() * 60 + slotDate.getMinutes();
        const duration = resolveBookingDurationMinutes(booking);
        const endMins = startMins + duration;

        if (!busyMap[dateKey]) {
          busyMap[dateKey] = [];
        }
        busyMap[dateKey].push({ startMins, endMins });
      });

      setMasterBusyIntervalsByDate(busyMap);
    } catch (err) {
      console.error('Ошибка загрузки расписания мастера:', err.message);
      setError('Не удалось загрузить рабочие дни и расписание мастера.');
    } finally {
      setLoadingAvailability(false);
    }
  }, []);

  // Загружаем актуальное расписание и занятые слоты при переходе на Шаг 3 или изменении refreshKey
  useEffect(() => {
    if (selectedMasterId && currentStep === 3) {
      fetchMasterAvailability(selectedMasterId);
    }
  }, [selectedMasterId, currentStep, refreshKey, fetchMasterAvailability]);

  const selectedMaster = useMemo(
    () => masters.find((m) => m.id === selectedMasterId) || null,
    [masters, selectedMasterId]
  );

  const selectedService = useMemo(
    () => masterServices.find((s) => s.id === selectedServiceId) || null,
    [masterServices, selectedServiceId]
  );

  const serviceDurationMinutes = useMemo(() => {
    const raw = Number(selectedService?.duration_minutes);
    return Number.isFinite(raw) && raw > 0 ? raw : 60;
  }, [selectedService]);

  const selectedScheduleRow = useMemo(
    () => masterScheduleRows.find((row) => row.date === selectedDateKey) || null,
    [masterScheduleRows, selectedDateKey]
  );

  /**
   * Рассчитывает список свободных слотов начала записи ('HH:MM') на выбранную дату.
   */
  const availableTimeSlots = useMemo(() => {
    if (!selectedScheduleRow || !selectedService) return [];

    const shiftStart = parseTimeToMinutes(selectedScheduleRow.start_time);
    const shiftEnd = parseTimeToMinutes(selectedScheduleRow.end_time);
    if (shiftStart === null || shiftEnd === null || shiftEnd <= shiftStart) {
      return [];
    }

    const busyIntervals = masterBusyIntervalsByDate[selectedDateKey] || [];
    const now = new Date();
    const isToday = selectedDateKey === formatLocalDateKey(now);
    const currentMinutesNow = now.getHours() * 60 + now.getMinutes();

    const slots = [];
    for (
      let candidateStart = shiftStart;
      candidateStart + serviceDurationMinutes <= shiftEnd;
      candidateStart += SLOT_STEP_MINUTES
    ) {
      const candidateEnd = candidateStart + serviceDurationMinutes;

      if (isToday && candidateStart <= currentMinutesNow) {
        continue;
      }

      const overlapsBusy = busyIntervals.some(
        (busy) => candidateStart < busy.endMins && candidateEnd > busy.startMins
      );

      if (!overlapsBusy) {
        slots.push(formatMinutesToHHMM(candidateStart));
      }
    }

    return slots;
  }, [
    selectedScheduleRow,
    selectedService,
    masterBusyIntervalsByDate,
    selectedDateKey,
    serviceDurationMinutes,
  ]);

  const handleSelectMaster = (masterId) => {
    if (masterId !== selectedMasterId) {
      setSelectedMasterId(masterId);
      setSelectedServiceId('');
      setSelectedDateKey('');
      setSelectedSlotHHMM('');
    }
    setError(null);
    setNotice(null);
  };

  const handleSelectService = (serviceId) => {
    if (serviceId !== selectedServiceId) {
      setSelectedServiceId(serviceId);
      setSelectedDateKey('');
      setSelectedSlotHHMM('');
    }
    setError(null);
    setNotice(null);
  };

  const handleNextStep = () => {
    setError(null);

    if (currentStep === 1) {
      if (!selectedMasterId) {
        setError('Пожалуйста, выберите мастера, чтобы перейти к выбору услуги.');
        return;
      }
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      if (!selectedServiceId) {
        setError('Пожалуйста, выберите услугу, чтобы перейти к выбору даты и времени.');
        return;
      }
      setCurrentStep(3);
    }
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };

  /**
   * Финальный обработчик отправки формы на Шаге 3:
   * проверяет доступность слота прямо перед записью с учётом индивидуальной длительности
   * и сохраняет новую запись в таблицу `bookings`.
   *
   * @param {React.FormEvent} e - Событие отправки формы
   */
  const handleConfirmBooking = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!client?.id) {
      setError('Не найден профиль клиента. Войдите в личный кабинет заново.');
      return;
    }
    if (!selectedMasterId || !selectedServiceId || !selectedDateKey || !selectedSlotHHMM) {
      setError('Завершите выбор мастера, услуги, даты и времени.');
      return;
    }

    const slotIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, selectedSlotHHMM);
    if (!slotIso) {
      setError('Некорректные дата или время записи.');
      return;
    }

    setSubmitting(true);

    try {
      const dayStartIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, '00:00');
      const dayEndIso = buildSlotIsoFromLocalDateAndTime(selectedDateKey, '23:59');

      const { data: freshBookings, error: checkError } = await supabase
        .from('bookings')
        .select('id, slot_time, status, duration_minutes, services(duration_minutes)')
        .eq('master_id', selectedMasterId)
        .neq('status', 'cancelled')
        .gte('slot_time', dayStartIso)
        .lte('slot_time', dayEndIso);

      if (checkError) throw checkError;

      const desiredStartMins = parseTimeToMinutes(selectedSlotHHMM);
      const desiredEndMins = desiredStartMins + serviceDurationMinutes;

      const conflictExists = (freshBookings || []).some((b) => {
        const dt = new Date(b.slot_time);
        if (Number.isNaN(dt.getTime())) return false;
        const bStart = dt.getHours() * 60 + dt.getMinutes();
        const bDur = resolveBookingDurationMinutes(b);
        const bEnd = bStart + bDur;
        return desiredStartMins < bEnd && desiredEndMins > bStart;
      });

      if (conflictExists) {
        setError('Этот слот только что заняли. Пожалуйста, выберите другое время.');
        setSelectedSlotHHMM('');
        await fetchMasterAvailability(selectedMasterId);
        return;
      }

      const { error: insertError } = await supabase.from('bookings').insert([
        {
          client_id: client.id,
          master_id: selectedMasterId,
          service_id: selectedServiceId,
          slot_time: slotIso,
          status: 'confirmed',
        },
      ]);

      if (insertError) throw insertError;

      setNotice(
        `Запись подтверждена! Мастер: ${selectedMaster?.full_name || 'специалист'}, услуга: «${
          selectedService?.title || ''
        }», дата и время: ${formatRussianDate(selectedDateKey)} в ${selectedSlotHHMM}.`
      );

      setSelectedSlotHHMM('');
      setSelectedDateKey('');
      setSelectedServiceId('');
      setCurrentStep(1);
      if (typeof onBookingCreated === 'function') {
        onBookingCreated();
      }
    } catch (err) {
      console.error('Ошибка при создании записи:', err.message);
      setError('Не удалось сохранить запись. Попробуйте выбрать другой слот или повторить позже.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-surface text-ink rounded-2xl shadow-md border border-slate-200 p-6 space-y-6 text-left">
      {/* Шапка блока онлайн-записи и горизонтальный степпер из CSS */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-brand-dark">Онлайн-запись</h2>
        </div>

        {/* Горизонтальный индикатор 3 шагов (стилизация полностью в ClientBooking.css) */}
        <ol className="booking-steps">
          {ONBOARDING_STEPS.map((step) => {
            const isActive = step.id === currentStep;
            const isCompleted = step.id < currentStep;
            const canJump =
              step.id === 1 ||
              (step.id === 2 && Boolean(selectedMasterId)) ||
              (step.id === 3 && Boolean(selectedMasterId && selectedServiceId));

            const stateClass = isActive
              ? 'booking-steps__btn--active'
              : isCompleted
              ? 'booking-steps__btn--completed'
              : '';

            return (
              <li key={step.id} className="booking-steps__item">
                <button
                  type="button"
                  disabled={!canJump}
                  onClick={() => {
                    if (canJump) {
                      setError(null);
                      setCurrentStep(step.id);
                    }
                  }}
                  className={`booking-steps__btn ${stateClass}`}
                >
                  <span className="booking-steps__badge">
                    {isCompleted ? '✓' : step.id}
                  </span>

                  <span className="booking-steps__content">
                    <span className="block booking-steps__title">{step.title}</span>
                    <span className="block booking-steps__subtitle">
                      {step.id === 1 && selectedMaster
                        ? selectedMaster.full_name
                        : step.id === 2 && selectedService
                        ? selectedService.title
                        : step.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {notice && (
        <div
          role="status"
          className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl text-sm font-medium"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-300 text-red-900 rounded-xl text-sm font-medium"
        >
          {error}
        </div>
      )}

      {/* =====================================================================
          ШАГ 1: ВЫБОР МАСТЕРА
         ===================================================================== */}
      {currentStep === 1 && (
        <div className="space-y-5">
          <h3 className="text-base font-bold text-ink">
            Шаг 1 из 3. Выберите мастера
          </h3>

          {loadingMasters ? (
            <p className="text-sm text-muted py-4">Загружаем список мастеров...</p>
          ) : masters.length === 0 ? (
            <p className="text-sm text-muted py-4">
              Пока нет зарегистрированных мастеров.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {masters.map((master) => {
                const isSelected = master.id === selectedMasterId;
                return (
                  <button
                    key={master.id}
                    type="button"
                    onClick={() => handleSelectMaster(master.id)}
                    className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-bold text-ink">{master.full_name}</div>
                    <div className="text-xs text-muted mt-1">
                      Специалист Beauty Hub
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handleNextStep}
              disabled={!selectedMasterId}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                selectedMasterId
                  ? 'bg-brand hover:bg-brand-hover text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              Далее: выбрать услугу →
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          ШАГ 2: ВЫБОР УСЛУГИ МАСТЕРА
         ===================================================================== */}
      {currentStep === 2 && (
        <div className="space-y-5">
          <h3 className="text-base font-bold text-ink">
            Шаг 2 из 3. Выберите услугу мастера{' '}
            <span className="text-brand-dark">{selectedMaster?.full_name}</span>
          </h3>

          {loadingServices ? (
            <p className="text-sm text-muted py-4">Загружаем услуги мастера...</p>
          ) : masterServices.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              У этого мастера пока нет активных услуг. Вернитесь назад и выберите другого специалиста.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {masterServices.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleSelectService(service.id)}
                    className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-400'
                    }`}
                  >
                    <div className="font-bold text-ink">{service.title}</div>
                    <div className="text-xs text-muted mt-1">
                      Длительность: {service.duration_minutes || 60} мин · Стоимость:{' '}
                      <span className="font-semibold text-ink">
                        {Number(service.price || 0).toLocaleString('ru-RU')} ₽
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePrevStep}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-ink transition cursor-pointer"
            >
              ← Назад к выбору мастера
            </button>

            <button
              type="button"
              onClick={handleNextStep}
              disabled={!selectedServiceId}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                selectedServiceId
                  ? 'bg-brand hover:bg-brand-hover text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
            >
              Далее: выбрать дату и время →
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          ШАГ 3: ВЫБОР ДАТЫ И ВРЕМЕНИ + ПОДТВЕРЖДЕНИЕ ЗАПИСИ
         ===================================================================== */}
      {currentStep === 3 && (
        <form onSubmit={handleConfirmBooking} className="space-y-5">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Мастер: <strong className="text-ink">{selectedMaster?.full_name}</strong>
            </span>
            <span>
              Услуга: <strong className="text-ink">{selectedService?.title}</strong> (
              {serviceDurationMinutes} мин,{' '}
              {Number(selectedService?.price || 0).toLocaleString('ru-RU')} ₽)
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-ink">
              Шаг 3 из 3. Выберите дату и время визита
            </h3>

            {selectedMasterId && (
              <button
                type="button"
                onClick={() => fetchMasterAvailability(selectedMasterId)}
                disabled={loadingAvailability}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-ink transition cursor-pointer disabled:opacity-60"
              >
                {loadingAvailability ? 'Обновляем...' : 'Обновить слоты'}
              </button>
            )}
          </div>

          {loadingAvailability ? (
            <p className="text-sm text-muted py-4">
              Загружаем рабочие дни и свободные слоты мастера...
            </p>
          ) : masterScheduleRows.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              У выбранного мастера пока нет открытых рабочих дней в расписании.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Доступные даты
                </div>
                <div className="flex flex-wrap gap-2">
                  {masterScheduleRows.map((row) => {
                    const isDateSelected = row.date === selectedDateKey;
                    return (
                      <button
                        key={row.id || row.date}
                        type="button"
                        onClick={() => {
                          setSelectedDateKey(row.date);
                          setSelectedSlotHHMM('');
                          setError(null);
                        }}
                        className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                          isDateSelected
                            ? 'bg-emerald-600 text-white border-emerald-700'
                            : 'bg-white text-slate-800 border-slate-300 hover:border-emerald-500'
                        }`}
                      >
                        {formatRussianDate(row.date)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedDateKey && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-semibold text-slate-700">
                    Свободное время на {formatRussianDate(selectedDateKey)} (услуга{' '}
                    {serviceDurationMinutes} мин):
                  </div>

                  {availableTimeSlots.length === 0 ? (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                      На выбранную дату нет свободных слотов подходящей длительности. Выберите другую дату или обновите расписание.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableTimeSlots.map((slot) => {
                        const isSlotSelected = slot === selectedSlotHHMM;
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => {
                              setSelectedSlotHHMM(slot);
                              setError(null);
                            }}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                              isSlotSelected
                                ? 'bg-brand text-white border-brand'
                                : 'bg-white text-slate-900 border-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={handlePrevStep}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-ink transition cursor-pointer"
            >
              ← Назад к выбору услуги
            </button>

            <button
              type="submit"
              disabled={submitting || !selectedDateKey || !selectedSlotHHMM}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
                submitting || !selectedDateKey || !selectedSlotHHMM
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-brand hover:bg-brand-hover text-white cursor-pointer shadow-sm'
              }`}
            >
              {submitting ? 'Сохраняем запись...' : 'Подтвердить запись'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}