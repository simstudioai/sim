# Subscription Billing Backfill Scripts

This directory contains scripts for backfilling and managing subscription billing data after implementing the usage-based billing system.

## Backfill Subscription Billing Data

### What it does

The `backfill-subscription-billing-data.ts` script initializes billing data for existing users who already have active subscriptions. This is necessary because the usage-based billing system added new fields to the `userStats` table that need to be populated with appropriate values.

### What gets backfilled

For each active subscription, the script will:

1. **Set usage limits** based on subscription plan:
   - **Free**: $5 per month
   - **Pro**: $20 per month  
   - **Team**: $40 per seat per month
   - **Enterprise**: Custom limit from metadata or $100 default

2. **Initialize billing periods** using existing subscription data:
   - Uses subscription `periodStart` and `periodEnd` if available
   - Falls back to monthly periods starting from subscription start date
   - Creates current billing cycle dates

3. **Create or update userStats records**:
   - For individual subscriptions: Updates the user's record
   - For organization subscriptions: Updates all organization members
   - Creates new `userStats` records if they don't exist

### How to run

#### 🔍 Dry Run Mode (Recommended First)

Always run the dry run first to see what changes would be made:

```bash
# Navigate to the sim app directory
cd apps/sim

# Run in dry run mode - shows what WOULD happen without making changes
bun run db:backfill:dry-run

# Alternative: Run directly with flag
bun run scripts/backfill-subscription-billing-data.ts --dry-run
```

#### 🚀 Live Mode (Apply Changes)

Once you've reviewed the dry run output and are satisfied with the planned changes:

```bash
# Run the actual backfill (applies changes to database)
bun run db:backfill

# Alternative: Run directly
bun run scripts/backfill-subscription-billing-data.ts
```

### Prerequisites

- Database must be migrated to the latest schema (migration 0048 applied)
- Active database connection 
- Environment variables properly configured

### What to expect

#### Dry Run Output

The dry run mode provides detailed analysis without making any changes:

```
🔍 DRY RUN MODE - Starting subscription billing data backfill...
⚠️  This is a DRY RUN - no actual changes will be made to the database
📝 All operations will be logged to show what WOULD happen

📊 Fetching subscription data...
📈 Found 15 active subscriptions

[DRY RUN] 🔄 Processing subscription sub_1234... (pro)
[DRY RUN]   👤 User subscription for: john@example.com
[DRY RUN]   💰 Usage limit: $20
[DRY RUN]   📅 Billing period: 2024-01-01T00:00:00.000Z - 2024-02-01T00:00:00.000Z
[DRY RUN - WOULD] Update userStats for user user_123:
[DRY RUN]       📊 Current limit: $5 → New limit: $20
[DRY RUN]       📅 Current billing start: null → New: 2024-01-01T00:00:00.000Z
[DRY RUN]       📅 Current billing end: null → New: 2024-02-01T00:00:00.000Z
[DRY RUN]     🔄 Would update existing userStats
[DRY RUN]   ✅ Processed successfully

🎉 Backfill analysis completed!
  📊 Total subscriptions found: 15
  ✅ Successfully processed: 15
  ⏭️  Skipped (no user/org found): 0
  ❌ Errors: 0

📝 Summary of changes that WOULD be made:
  ✨ New userStats records to create: 3
  🔄 Existing userStats records to update: 12
  🎯 Total database operations: 15

💡 To apply these changes, run the script without --dry-run
```

#### Live Mode Output

The live mode shows actual changes being applied:

```
🚀 LIVE MODE - Starting subscription billing data backfill...

📊 Fetching subscription data...
📈 Found 15 active subscriptions

🔄 Processing subscription sub_1234... (pro)
  👤 User subscription for: john@example.com
  💰 Usage limit: $20
  📅 Billing period: 2024-01-01T00:00:00.000Z - 2024-02-01T00:00:00.000Z
[EXECUTING] Update userStats for user user_123:
      📊 Current limit: $5 → New limit: $20
      📅 Current billing start: null → New: 2024-01-01T00:00:00.000Z
      📅 Current billing end: null → New: 2024-02-01T00:00:00.000Z
    🔄 Updated existing userStats
  ✅ Processed successfully

🎉 Backfill analysis completed!
  📊 Total subscriptions found: 15
  ✅ Successfully processed: 15
  ⏭️  Skipped (no user/org found): 0
  ❌ Errors: 0

✅ Applied changes:
  ✨ New userStats records created: 3
  🔄 Existing userStats records updated: 12
  🎯 Total database operations: 15
```

### Safety notes

- **Always run dry run first** to verify planned changes
- The script is idempotent - safe to run multiple times
- Only processes active subscriptions
- Will not overwrite existing billing data unnecessarily
- All database operations are wrapped in try/catch blocks
- Logs all actions for auditing purposes
- Dry run mode makes **zero database changes**

### Troubleshooting

**"Could not find user or organization for referenceId"**
- This means the subscription's `referenceId` doesn't match any user or organization ID
- May indicate orphaned subscriptions that need manual cleanup

**Database connection errors**
- Ensure your `.env` file has correct database credentials
- Check that the database is running and accessible

**Permission errors**
- Make sure the database user has sufficient permissions to read/write the required tables

### Recommended workflow

1. **First, run dry run**: `bun run db:backfill:dry-run`
2. **Review the output** carefully to ensure the planned changes are correct
3. **If everything looks good**, run the live version: `bun run db:backfill`
4. **Verify results** using the post-backfill verification steps below

### Post-backfill verification

After running the backfill, you can verify the results by:

1. Checking the subscription modal in the UI shows correct usage limits
2. Running a database query to ensure all active subscription holders have proper billing data:

```sql
SELECT 
  u.email,
  s.plan,
  us.current_usage_limit,
  us.billing_period_start,
  us.billing_period_end
FROM subscription s
JOIN user u ON s.reference_id = u.id
JOIN user_stats us ON u.id = us.user_id
WHERE s.status = 'active';
```

3. Monitoring the logs for any usage tracking issues in workflows 