-- Device display names. A customer-set friendly label ("Baby's thermometer")
-- shown instead of the meaningless BD address in pickers and lists; NULL means
-- "unnamed" and every surface falls back to the model string. Owner-scoped to
-- write (DeviceController#renameLabel), readable alongside the rest of the row.
ALTER TABLE devices
    ADD COLUMN label VARCHAR(64);
