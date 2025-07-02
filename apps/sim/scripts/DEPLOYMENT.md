# Usage-Based Billing Deployment Guide

This document outlines the safe deployment strategy for rolling out the usage-based billing system to production.

## 🎯 Deployment Goals

- Zero downtime for existing users
- No disruption to existing subscription holders
- Safe rollback capability at each step
- Minimal risk window for incorrect billing limits

## ⚠️ Critical Considerations

**The Risk**: If we deploy the application code before running the backfill script, existing subscription holders will temporarily get free tier limits ($5) instead of their paid plan limits, potentially blocking their workflows.

**The Solution**: Deploy in carefully sequenced phases with immediate backfill execution.

## 📋 Deployment Plan

### Phase 0: Pre-Migration Analysis (No Risk)
**Objective**: Analyze existing data before any changes

```bash
# Run analysis on current production data (safe - no schema changes needed)
bun run db:analyze
```

**What it does**:
- Analyzes all active subscriptions
- Calculates what usage limits would be set
- Identifies potential issues (orphaned subscriptions, missing userStats, etc.)
- Provides exact counts of planned database operations
- **Requires no schema changes** - safe to run anytime

**Sample Expected Output**:
```
🔍 Analyzing subscription data for backfill planning...
⚠️  This script analyzes EXISTING data to predict backfill changes
📋 Safe to run before migration - only reads current schema

📊 Subscription Breakdown:
  👤 User subscriptions: 45
  🏢 Organization subscriptions: 12
  ❓ Unknown reference IDs: 0

💰 Limit Changes Needed:
  ✨ New userStats records to create: 5
  🔄 Existing userStats records to update: 142
  🎯 Total database operations planned: 147

📝 Note: Current usage limits not shown (columns don't exist yet)
    After migration, backfill will set these calculated limits
```

**Critical Checkpoints**:
- [ ] All subscriptions have valid user/organization references
- [ ] Calculated limits match expectations for each plan type
- [ ] No unexpected enterprise subscriptions without metadata
- [ ] Total operation count seems reasonable

### Phase 1: Database Migration (Low Risk)
**Objective**: Add new columns with safe defaults

```bash
# 1. Deploy database migration to production
cd apps/sim
bun run db:migrate
```

**Result**: 
- New columns added to `user_stats` table
- All existing users get $5 default limit (safe for free users)
- Paid users temporarily have lower limits (but app isn't using them yet)

**Verification**:
```sql
-- Verify new columns exist
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'user_stats' 
AND column_name IN ('current_usage_limit', 'billing_period_start', 'current_period_cost');
```

### Phase 2: Pre-Flight Backfill Analysis
**Objective**: Verify backfill script works correctly

```bash
# Run dry run on production data to validate
bun run db:backfill:dry-run
```

**Critical Checkpoints**:
- [ ] Script finds all active subscriptions
- [ ] Calculated usage limits match expectations
- [ ] No errors in dry run output
- [ ] Total operations count looks reasonable

**Sample Expected Output**:
```
📝 Summary of changes that WOULD be made:
  ✨ New userStats records to create: 5
  🔄 Existing userStats records to update: 142
  🎯 Total database operations: 147
```

### Phase 3: Application Code Deployment (High Risk Window)
**Objective**: Deploy new billing-aware application code

```bash
# Deploy application code
# (Your normal deployment process - Vercel, Docker, etc.)
```

**⚠️ Risk Window Begins**: Paid users now have $5 limits while app uses new billing system

**Critical**: Execute Phase 4 immediately after this deployment

### Phase 4: Immediate Backfill Execution (Critical)
**Objective**: Restore correct limits for subscription holders

```bash
# Execute backfill immediately after code deployment
bun run db:backfill
```

**Expected Timeline**: 
- Execution time: ~30 seconds to 2 minutes (depends on subscriber count)
- Risk window: Minutes, not hours

**Verification**:
```sql
-- Verify subscription holders have correct limits
SELECT 
  u.email,
  s.plan,
  s.seats,
  us.current_usage_limit,
  CASE 
    WHEN s.plan = 'pro' THEN 20
    WHEN s.plan = 'team' THEN (COALESCE(s.seats, 1) * 40)
    WHEN s.plan = 'enterprise' THEN 100
    ELSE 5
  END as expected_limit
FROM subscription s
JOIN user u ON s.reference_id = u.id
JOIN user_stats us ON u.id = us.user_id
WHERE s.status = 'active'
ORDER BY s.plan, u.email;
```

### Phase 5: Post-Deployment Verification
**Objective**: Confirm everything works correctly

**UI Verification**:
- [ ] Subscription modal shows correct usage limits
- [ ] Usage progress bars display properly  
- [ ] Upgrade buttons work for free users
- [ ] Team management functions work

**Database Verification**:
```sql
-- Check for any users without billing periods
SELECT COUNT(*) as users_missing_billing_period
FROM user_stats 
WHERE billing_period_start IS NULL OR billing_period_end IS NULL;

-- Should return 0 or very few results
```

**Functionality Testing**:
- [ ] Run a workflow and verify usage tracking
- [ ] Test usage limit warnings/blocks
- [ ] Verify team seat management
- [ ] Test subscription upgrades

## 🚨 Emergency Rollback Plan

If issues arise during deployment:

### Option 1: Quick Fix (Preferred)
```bash
# If backfill failed, re-run it
bun run db:backfill:dry-run  # Analyze
bun run db:backfill          # Execute
```

### Option 2: Temporary Limit Boost
```sql
-- Emergency: Temporarily raise all limits to prevent blocking
UPDATE user_stats 
SET current_usage_limit = '100' 
WHERE current_usage_limit::numeric < 20;
```

### Option 3: Full Rollback
```bash
# Revert application code to previous version
# (Your normal rollback process)

# Note: Database columns can remain (they won't hurt anything)
```

## 📊 Monitoring During Deployment

**Key Metrics to Watch**:
- Workflow execution success rates
- User complaints about usage limits
- API error rates related to billing
- Subscription upgrade/downgrade rates

**Alerts to Set**:
- Spike in workflow failures
- Increase in "usage limit exceeded" errors
- Users reporting incorrect subscription limits

## 🕒 Recommended Deployment Window

**Best Time**: Low traffic hours (e.g., weekend or late evening in your primary timezone)

**Estimated Duration**:
- Phase 0 (Pre-analysis): 1-2 minutes
- Phase 1 (Migration): 30 seconds
- Phase 2 (Dry run): 1-2 minutes  
- Phase 3 (Code deploy): 2-5 minutes (depends on platform)
- Phase 4 (Backfill): 30 seconds - 2 minutes
- Phase 5 (Verification): 10-15 minutes

**Total**: 15-27 minutes for complete deployment

## 👥 Team Coordination

**Required Roles**:
- **Database Admin**: Execute migrations and backfill
- **DevOps Engineer**: Handle application deployment
- **Product Manager**: Monitor user impact and complaints
- **Support Team**: Ready to handle user questions

**Communication Plan**:
1. Notify team before starting Phase 3
2. All-clear after Phase 4 completes successfully  
3. Final confirmation after Phase 5 verification

## 📝 Deployment Checklist

### Pre-Deployment
- [ ] Pre-migration analysis completed and reviewed: `bun run db:analyze`
- [ ] Database migration tested in staging
- [ ] Backfill script tested with staging data
- [ ] Application code tested with new billing system
- [ ] Rollback plan ready and tested
- [ ] Team notified and on standby

### During Deployment  
- [ ] Phase 0: Pre-migration analysis shows expected results
- [ ] Phase 1: Migration completed successfully
- [ ] Phase 2: Dry run shows expected results
- [ ] Phase 3: Application deployed without errors
- [ ] Phase 4: Backfill completed successfully
- [ ] Phase 5: Verification passed

### Post-Deployment
- [ ] Monitor metrics for 24-48 hours
- [ ] Confirm no user complaints
- [ ] Document any lessons learned
- [ ] Celebrate successful deployment! 🎉

## 🔧 Alternative: Feature Flag Approach

For even safer deployment, consider adding a feature flag:

```typescript
// In your billing code
const useNewBillingSystem = process.env.ENABLE_USAGE_BILLING === 'true'

if (useNewBillingSystem) {
  // Use new usage-based billing
} else {
  // Fall back to old system
}
```

This allows you to:
1. Deploy code with feature disabled
2. Run backfill script
3. Enable feature flag when ready
4. Gradually roll out to percentage of users 