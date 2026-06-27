# Сообщения интернационализации (i18n)

## Структура

Каждый модуль приложения — отдельный файл. Это позволяет:

- **Не плодить merge-конфликты** — каждый разработчик меняет только свой модуль
- **Быстро находить** нужный ключ
- **Добавлять модули** без изменения существующих файлов
- **Ленивую загрузку** в будущем

```
messages/
├── en/
│   ├── common.json      ← 52 ключа (save, cancel, delete, yes/no...)
│   ├── nav.json         ← 10 ключей (home, workflows, tables...)
│   ├── billing.json     ← 24 ключа (free, pro, overage, invoice...)
│   ├── workspace.json   ← 14 ключей (members, owner, admin...)
│   ├── workflow.json    ← 28 ключей (run, stop, trigger, webhook...)
│   ├── errors.json      ← 9 ключей (unknown, network, forbidden...)
│   ├── time.json        ← 25 ключей (today, minutes_2, ago, in...)
│   ├── editor.json      ← 16 ключей (undo, zoomIn, group...)
│   ├── chat.json        ← 12 ключей (thinking, regenerate, send...)
│   └── notifications.json ← 16 ключей (executionFailed, saved...)
├── ru/
│   └── ... (те же модули, русские переводы)
```

## Добавление нового модуля

1. **Создай** `messages/en/новый_модуль.json` и `messages/ru/новый_модуль.json`
2. **Добавь** имя модуля в массив `TRANSLATION_MODULES` в `lib/i18n/request.ts`
3. **Используй** в компонентах: `const t = useTranslations('новый_модуль')` → `t('ключ')`

## Соглашения

- Ключи — `camelCase`
- Русские склонения: `key` (1), `key_2` (2-4), `key_5` (5+) — используется с плюрализацией
- Файлы не больше ~2KB — если растёт, разбивай на подмодули
