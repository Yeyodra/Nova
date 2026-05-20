use sqlx::SqlitePool;

use crate::error::AppResult;

pub async fn get_setting(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = ?",
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;

    Ok(())
}
