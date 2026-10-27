# Friends & Groups change log

A plain-language record of each Friends & Groups task, written for review.
Each entry explains what changed, why, and what you will see differently, with
examples. Personal Finance code is not touched by any of these tasks.

Plan: Splitwise-style Friends & Groups on ResilientDB, implemented one task at a
time. The person who adds an expense is always the payer (their ResVault wallet
signs it), and shares are entered manually.

---

## Task 1 — Show errors instead of failing silently

**Status:** done, committed in `16bd6bb`. Task 3 later replaced the
`wallet=amount` text box, so the share-related examples below no longer
appear; the error handling itself is unchanged and still used by every form.

### The problem in one sentence

When something went wrong before the request reached the server, the Groups
page did nothing at all: no message, no change. It looked broken.

### Why it happened

Each form's submit button started some work in the background, but nobody was
listening for failures. If the work failed early, the error disappeared.

Things that failed early (before any server call):

- A share line was typed wrong, for example `0x123=10` (bad wallet) or
  `0xaaa…aaa 10` (missing `=`).
- An amount was zero or invalid, for example `0`, `0.00`, or `1.234`.
- The placeholder text in the shares box (`0x…=0.00` for every member) was
  submitted as-is. Zero shares are not allowed, so this always failed.
- You clicked **Cancel** in ResVault, or ResVault was locked or not installed.

There was a second, smaller problem: an old error message from a previous
attempt could stay on screen even after you fixed the input.

### What changed

Every Groups form now catches its own failures and shows a red message right
under that form. The message is cleared as soon as you submit again.

This applies to all six forms:

| Form                        | Example of an error you can now see                           |
| --------------------------- | ------------------------------------------------------------- |
| Create group                | Server says the request was rejected                          |
| Add member                  | Server says the wallet is already a member                    |
| Fund internal credits       | `Amount must be greater than $0.00.`                          |
| Create signed expense       | `A share has an invalid wallet address`                       |
| Approve / reject obligation | `User rejected the request in ResVault`                       |
| Settle with credits         | `Enter a positive USD amount with no more than two decimals.` |

Errors stay with the form they belong to. If the expense form shows an error
and you then make a mistake in the credits form, each form shows its own
message; one does not overwrite the other.

### Example: before and after

You are in a group with Alex and Sam. You add "Dinner", total `60.00`, and
leave Alex's share as `0.00`:

```text
0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0.00
0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=60.00
```

- **Before:** you click **Approve split in ResVault** and nothing happens.
- **After:** a red message appears under the form:
  `Amount must be greater than $0.00.` You remove Alex's line, submit again,
  the message disappears, and ResVault opens.

If you then click **Cancel** in ResVault:

- **Before:** nothing happens.
- **After:** `User rejected the request in ResVault` appears under the form.

### Files changed

| File                                                 | What it does now                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `client/src/features/groups/useGroupAction.ts` (new) | Small helper each form uses: clear the old error, run the action, catch and keep any new error.            |
| `client/src/features/groups/shares.ts` (new)         | The code that reads `wallet=amount` lines. Moved out of the page unchanged so it can be tested on its own. |
| `client/src/features/groups/GroupsDashboard.tsx`     | All six forms use the helper and show their own error.                                                     |
| `client/src/features/groups/shares.test.ts` (new)    | Unit tests for reading share lines.                                                                        |
| `tests/e2e/groups-dashboard.spec.ts`                 | New browser test for the error messages.                                                                   |

### What did not change

- No server, contract, or ResilientDB behavior changed.
- The expense form still uses the `wallet=amount` text box. Replacing it with a
  per-member form is Task 3.
- Members are still shown only as a count. Showing names is Task 2.

### How it was tested

- Type check and lint: pass.
- Unit tests: 13 of 13 pass. The 3 new tests check that share lines are read
  correctly (`10.00` becomes 1000 cents, wallet case is normalized) and that
  bad format, bad wallet, duplicate wallet, empty input, and `=0.00` each give
  a clear message.
- Browser tests (Chromium, mocked server): 2 of 2 pass.
  - The existing approve → fund → partial settle → full settle flow still works.
  - The new test enters a zero share, cancels ResVault, and enters a $0 credit
    amount. It checks that each form shows the right message, and that no
    request was sent to the server in any of these cases.

### How to try it yourself

1. Open **Friends & Groups** and select a group.
2. In **Create signed expense**, enter a total and a share of `0.00`, then
   submit. You should see the zero-amount message.
3. Fix the share, submit, and click **Cancel** in ResVault. You should see the
   ResVault rejection message.

---

## Task 2 — Show group members by name

**Status:** done, committed in `16bd6bb`. The separate Members panel described
here was later replaced by a compact popover in Task 2b.

### The problem in one sentence

The group page only said "Members: 2". You could not see who was in the group,
even though everyone's display name was already saved.

### Why it happened

When you create a group or add a member, you type a display name, and the
server stores it and sends it back. The page simply never displayed it; it
counted the members and threw the names away.

### What changed

1. **New Members panel.** It sits right under the group summary and lists every
   member by display name, as small rounded chips.
2. **Wallet address on hover.** Hover over a name (or tab to it with the
   keyboard) and a small box pops up with that person's full wallet address.
   The name has a dotted underline so you can tell it is hoverable.
3. **Owner and You labels.** The person who created the group gets an
   `OWNER` label. Your own chip gets a `YOU` label.
4. **Empty state.** If you are not in any group yet, the page now says:
   "No groups yet. Create one above, then add friends by wallet address to
   start splitting expenses." Before, it showed only the create form with no
   explanation.

### Example: before and after

Alex creates a group called "Friends" and adds Sam. Sam opens the page.

- **Before:**

  ```text
  Members
  2
  ```

- **After:**

  ```text
  Members                                   2 total
  [ Alex  OWNER ]  [ Sam  YOU ]
  Hover over or focus a name to see the member's wallet address.
  ```

  Hovering over **Alex** shows:

  ```text
  0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  ```

If a wallet ever shows up that is not a group member, the page falls back to a
shortened address such as `0xaaaaaa…aaaaaa` rather than showing nothing.

### A reusable piece for later tasks

The name-with-address-on-hover display is its own small component
(`MemberName`). Task 4 will reuse it so that obligations read
"Sam owes Alex" instead of "0xbbbbbb…bbbbbb owes 0xaaaaaa…aaaaaa".

### Files changed

| File                                               | What it does now                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `client/src/features/groups/members.ts` (new)      | Looks up a member's display name from a wallet address (ignoring upper/lower case), and shortens addresses. |
| `client/src/features/groups/MemberName.tsx` (new)  | Shows a name, with the full wallet address in a pop-up on hover or keyboard focus.                          |
| `client/src/features/groups/GroupsDashboard.tsx`   | Adds the Members panel and the "No groups yet" message.                                                     |
| `client/src/app/styles.css`                        | Styles for the member chips, labels, and address pop-up. Works in light and dark mode.                      |
| `client/src/features/groups/members.test.ts` (new) | Unit tests for the name lookup.                                                                             |
| `tests/e2e/groups-dashboard.spec.ts`               | Browser checks for the Members panel, the hover pop-up, and the empty state.                                |

### What did not change

- No server, contract, or ResilientDB behavior changed. The names were already
  stored; this task only displays them.
- Obligations, the expense form, and notifications still show shortened
  wallet addresses. Those switch to names in Tasks 3 and 4.
- Only the owner can add members, as before.

### How it was tested

- Type check, lint, and production build: pass.
- Unit tests: 16 of 16 pass. The 3 new tests check that a wallet address finds
  the right name (even with different capitalization), that an unknown wallet
  returns nothing, and that addresses shorten correctly.
- Browser tests (Chromium, mocked server): 3 of 3 pass.
  - The main flow test now also checks that Alex shows `OWNER`, Sam shows
    `YOU`, the address pop-up is hidden until you hover, shows Alex's exact
    address on hover, hides again when the mouse leaves, and also appears when
    you tab to a name with the keyboard.
  - A new test checks the "No groups yet" message for a user with no groups.
  - The Task 1 error-message test still passes.

### How to try it yourself

1. Open **Friends & Groups** and select a group.
2. Look for the **Members** panel under the group summary.
3. Hover over any name to see the wallet address, or press Tab until a name is
   highlighted.

---

## Task 2b — Compact members popover

**Status:** done, committed in `fd5c867`.

### The problem in one sentence

The page was crowded: the group's name and member count appeared in three
stacked blocks, and Task 2 had added a whole extra panel just for names.

### What changed

1. **The separate Members panel is gone.** One less block on the page.
2. **The "Members" tile in the group summary is now a button.** It shows only
   the count, worded so it is clearly clickable: `2 members ▾` (or
   `1 member ▾`). Names are left out of the tile on purpose, since the popover
   shows them, and this keeps the tile the same size however big the group is.
3. **Clicking it opens a small card (a "popover") right under the tile.** For
   each member it shows:
   - their display name, with `OWNER` and `YOU` labels where they apply;
   - their wallet address, shortened, such as `0xaaaaaa…aaaaaa`. Hover over it
     to see the full address;
   - a **Copy** button that copies the full address. It briefly changes to
     `Copied` (or `Copy failed` if the browser blocks clipboard access).
4. **Closing it.** Press Escape, click anywhere outside it, or click the
   Members button again. Pressing Escape puts the keyboard focus back on the
   Members button.

### Example: before and after

Sam opens the "Friends" group, which has Alex (owner) and Sam.

- **Before (Task 2):** a summary card with `Members: 2`, then a separate
  Members panel with name chips and a hint line underneath.
- **After:** only the summary card, with `Members: 2 members ▾`. Clicking it
  shows:

  ```text
  Alex  OWNER
  0xaaaaaa…aaaaaa                 [Copy]
  ───────────────────────────────────
  Sam   YOU
  0xbbbbbb…bbbbbb                 [Copy]
  ```

  Clicking **Copy** next to Alex puts
  `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` on your clipboard, ready to
  paste.

### Small layout fixes that came with it

- The popover floats above the panels below it instead of being hidden behind
  them.
- It stays fully on screen on both a laptop and a phone-sized screen. On a
  phone it covers the "Your credits" tile while open.

### Files changed

| File                                               | What it does now                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `client/src/features/groups/MembersMenu.tsx` (new) | The Members button and popover: open/close, Owner/You labels, shortened address, Copy button. |
| `client/src/features/groups/members.ts`            | Adds the `1 member` / `2 members` label.                                                      |
| `client/src/features/groups/GroupsDashboard.tsx`   | Uses the new Members button in the summary card; removes the separate Members panel.          |
| `client/src/app/styles.css`                        | Styles for the button and popover; removes the old panel styles.                              |
| `client/src/features/groups/members.test.ts`       | Unit test for the member count label.                                                         |
| `tests/e2e/groups-dashboard.spec.ts`               | Browser checks for the popover.                                                               |

`MemberName.tsx` from Task 2 (name with full address on hover) is no longer
used on the page right now. It is kept on purpose: Tasks 3 and 4 use it for
the expense rows and for "Sam owes Alex" on obligations.

### What did not change

- No server, contract, or ResilientDB behavior changed.
- The group switcher at the top still shows "2 members · 1 open" for each
  group, so you can compare groups at a glance.

### How it was tested

- Type check, lint, and production build: pass.
- Unit tests: 17 of 17 pass. The new test checks the label reads `1 member`
  for one person and `2 members` / `6 members` otherwise.
- Browser tests (Chromium, mocked server): 3 of 3 pass. The main flow test now
  checks that:
  - the popover is closed at first and opens on click;
  - Alex shows `OWNER` and Sam shows `YOU`;
  - Alex's address shows as `0xaaaaaa…aaaaaa` with the full address on hover;
  - **Copy** really puts Alex's full address on the clipboard and the button
    shows `Copied`;
  - Escape closes it and returns focus to the Members button, and clicking
    outside also closes it;
  - the popover fits fully on screen at laptop width and at phone width
    (390 pixels wide).

### How to try it yourself

1. Open **Friends & Groups** and select a group.
2. In the group summary card, click the **Members** tile.
3. Hover over an address to see it in full, or click **Copy**.
4. Press Escape or click elsewhere to close it.

---

## Task 3 — Splitwise-style expense form

**Status:** done, committed in `fd5c867`.

### The problem in one sentence

To add an expense you had to type raw lines like
`0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=60.00` into a text box, one per
person, and work out yourself whether they added up.

### What changed

The text box is replaced by a **Split between** list with one row per group
member, and a choice of how to split.

**Split equally** (the default). Type the total, untick anyone who was not
there, and the amounts fill in by themselves:

```text
Add an expense
Description  [Dinner ]     Total amount  [90.00 ]

Split between
( • Split equally )  (   Exact amounts )
Paid by you (Alex). Tick everyone who shares this expense. The total is
divided equally between them. Your own share does not create a debt.

[x] Alex  YOU                          $45.00
[x] Sam                                $45.00
[ ] Priya                        Not included

All $90.00 assigned, split equally between 2 people.

          [Approve split in ResVault]
```

**Exact amounts.** Switch when people did not share equally. The boxes start
with the equal amounts already filled in, so you only change the ones that
differ:

```text
(   Split equally )  ( • Exact amounts )

[x] Alex  YOU                      [30.00       ]
[x] Sam                            [60.00       ]
[ ] Priya                          [Not included]

All $90.00 assigned.
```

1. **Tick who is in this expense.** Everyone is ticked to start. Untick anyone
   who was not part of it and they are left out completely.
2. **Equal by default.** The total is divided between everyone ticked and
   recalculated the moment you tick, untick, or change the total.
3. **Odd cents.** When the total does not divide evenly, the extra cent goes to
   you (the payer) first, so nobody else owes more than their fair share.
   Example: $10.01 between Alex (you) and Sam is Alex $5.01, Sam $5.00, so Sam
   owes $5.00. If you are not part of the split, extra cents go to the first
   people in the list.
4. **Exact amounts when you need them.** Switching to Exact amounts copies the
   current equal amounts into editable boxes. Switching back to Split equally
   recalculates; if you then switch to Exact amounts again, it starts from the
   fresh equal amounts rather than your earlier edits.
5. **Live running total** under the list, updated as you type (Exact amounts):
   - `$0.00 of $90.00 assigned · $90.00 left` (grey: still to assign)
   - `$100.00 of $90.00 assigned · $10.00 over` (red: too much)
   - `All $90.00 assigned.` (green: ready to sign)
6. **Names, not wallets.** Each row shows the member's display name. Hover over
   a name to see their full wallet address (this reuses the `MemberName` piece
   from Task 2).
7. **Clear error messages** that name the person, shown under the form if you
   submit something that does not work:

   | What you did            | Message                                                                          |
   | ----------------------- | -------------------------------------------------------------------------------- |
   | Left the total empty    | `Total amount: Enter a positive USD amount with no more than two decimals.`      |
   | Unticked everyone       | `Choose at least one member to split with.`                                      |
   | Ticked only yourself    | `Include at least one other member. Your own share does not create a debt.`      |
   | Gave Sam `0.00`         | `Sam's share: Amount must be greater than $0.00.`                                |
   | Shares total $50 of $60 | `Shares add up to $50.00, but the total is $60.00. Assign the remaining $10.00.` |
   | Shares total $65 of $60 | `Shares add up to $65.00, which is $5.00 more than the total of $60.00.`         |

   The last three rows only apply to Exact amounts; an equal split always adds
   up. In Split equally, a share can still come out as $0.00 if the total is
   smaller than one cent per person (for example $0.02 between three people),
   and you will get the `$0.00` message for that person.

8. **The form resets after a successful save:** fields are cleared, everyone is
   ticked again, and it goes back to Split equally.
9. The panel heading is now **Add an expense** instead of
   "Create signed expense".

### Who owes whom (unchanged rules, now easier to see)

You are always the payer, because your ResVault wallet signs the expense.
Everyone else you tick owes you their amount. Your own share is just the part
you covered for yourself, so it creates no debt.

Example (equal): Alex pays $90 for dinner with Sam; Priya was not there. Alex
unticks Priya and leaves Split equally on.

- Alex and Sam are $45 each.
- Sam now owes Alex **$45**.
- Alex's own $45 creates nothing. Priya is not involved at all.

Example (exact): same dinner, but Sam ordered more. Alex switches to Exact
amounts and changes the boxes to Alex $30, Sam $60. Sam owes Alex **$60**.

You can also leave yourself out. If Alex pays $60 for Sam and Priya only,
Alex unticks Alex and leaves Split equally on: Sam and Priya each owe Alex
$30.

### What the server receives

Exactly the same request shape as before, whichever split mode you use, so no
server change was needed. The equal split is worked out in the browser before
signing, and the server still checks that the shares add up exactly. For the
exact dinner example:

```json
{
  "payer_address": "0xaaaa…aaaa",
  "description": "Dinner",
  "amount": { "currency": "USD", "minor_units": 9000 },
  "shares": {
    "0xaaaa…aaaa": { "currency": "USD", "minor_units": 3000 },
    "0xbbbb…bbbb": { "currency": "USD", "minor_units": 6000 }
  }
}
```

Amounts are whole cents (9000 = $90.00), never decimals. Unticked members are
left out of `shares` entirely.

### Files changed

| File                                                                  | What it does now                                                                                                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/features/groups/split.ts` (new)                           | The split rules: the equal split (including where odd cents go), building the shares from ticked rows, the running total, and the error messages above.                                        |
| `client/src/features/groups/SplitEditor.tsx` (new)                    | The "Split between" list: Split equally / Exact amounts choice, checkbox, name with address on hover, amount (shown or editable), and running total.                                           |
| `client/src/features/groups/GroupsDashboard.tsx`                      | The expense form uses the new list instead of the text box.                                                                                                                                    |
| `client/src/features/groups/shares.ts` and `shares.test.ts` (removed) | The old `wallet=amount` reader; nothing uses it any more.                                                                                                                                      |
| `client/src/app/styles.css`                                           | Styles for the split list and running total.                                                                                                                                                   |
| `client/src/features/groups/split.test.ts` (new)                      | Unit tests for the split rules.                                                                                                                                                                |
| `tests/e2e/groups-dashboard.spec.ts`                                  | Two new browser tests (equal split, exact amounts); the error test now uses the new form. Shared test setup moved into small helpers.                                                          |
| `tests/e2e-live/local-handoff.spec.ts`                                | The real two-wallet test now unticks the Owner and checks that the equal split gives the Member $60.00, instead of typing a `wallet=amount` line.                                              |
| `docs/local-demo-runbook.md`                                          | The Friends & Groups demo steps now describe the new form.                                                                                                                                     |
| `README.md`                                                           | The feature list already promised "equal or custom splits", but equal splits did not exist until now. It now says you choose who shares each expense and split it equally or by exact amounts. |

### What did not change

- No server, contract, or ResilientDB behavior changed. The server already
  accepted shares for any subset of members; only the form changed.
- The payer is still always you. Recording that someone else paid is not
  supported, because the payer must sign.
- No percentage or "shares" split modes; only equal and exact amounts.
- Obligations and notifications still show shortened wallets; that is Task 4.

### How it was tested

- Type check, lint, and production build: pass.
- Unit tests: 26 of 26 pass. The 12 new tests check:
  - the equal split divides evenly ($90 between three is $30 each);
  - odd cents go to the payer first ($10.00 between three, payer Sam: Sam
    $3.34, the others $3.33), then in list order when the payer is left out;
  - equal amounts fill only ticked rows, stay blank until the total is valid,
    and always add up exactly;
  - shares include only ticked members, in whole cents, and the payer can be
    left out;
  - every error message in the table above;
  - the running total while typing.
- Browser tests (Chromium, mocked server): 5 of 5 pass. Two new tests, with
  Alex, Sam, and Priya in the group:
  - **Equal split:** Split equally is selected to start; $90 shows $30.00 for
    each person; unticking Priya changes Alex and Sam to $45.00; $10.01 shows
    Alex $5.01 and Sam $5.00; hovering Sam shows his wallet; the request sent
    has exactly 501 and 500 cents, Alex as payer, and a `split.approve`
    signature for this expense; the form resets to Split equally afterwards.
  - **Exact amounts:** switching fills each box with $30.00; unticking Priya
    shows "$30.00 left"; Sam $70 shows "$10.00 over"; Sam $60 balances; the
    request has Alex 3000 and Sam 6000 cents.
- The error-message test from Task 1 now switches to Exact amounts, enters a
  `0.00` share for Alex, then unticks Alex and cancels in ResVault. The main
  approve, fund, and settle test still passes.
- The real two-wallet test (`tests/e2e-live`) was updated and confirmed to
  load, but was **not run**: it needs the full local stack and two ResVault
  browser profiles. Run it with `npm --prefix client run test:e2e:local` when
  the stack is up.

### How to try it yourself

1. Open **Friends & Groups** and select a group with at least two members.
2. In **Add an expense**, enter a description and a total.
3. Untick anyone who was not part of it. The amounts fill in equally.
4. To change someone's amount, choose **Exact amounts**, edit the boxes, and
   watch the line under the list turn green when it adds up.
5. Click **Approve split in ResVault** and approve in the extension. The new
   obligations appear under **Obligations**.

---

## Fix — Show when the page is waiting for ResVault

**Status:** done, not yet committed.

### The problem in one sentence

After clicking **Approve split in ResVault**, the page gave no sign it was
waiting, so if the ResVault approval window did not appear, the button looked
broken.

### Why it happened

Every signed action (add expense, approve/reject, fund credits, settle) asks
the ResVault extension to open a small approval window, then waits up to two
minutes for your answer. During that wait the page showed nothing and the
button stayed clickable.

The approval window can fail to show up for two reasons:

- It opened, but behind the browser, or in another desktop Space when Chrome
  is full screen.
- The page lost its connection to the extension. Chrome shuts down an idle
  extension's background process after about 30 seconds. The page's link to
  the extension is never reopened, so later requests go nowhere until the page
  is reloaded. **This part is not fixed yet**; it lives in the shared ResVault
  extension code (`resvault/src/content.ts`).

### What changed

Every Groups form now shows what it is doing, and its button is disabled until
it finishes:

| Stage                           | What you see under the form                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting for ResVault            | A spinner and "Waiting for your approval in ResVault. If no ResVault window appeared, check behind this browser window, or reload the page and try again." |
| Approved, sending to the server | A spinner and "Saving to the group…"                                                                                                                       |
| Done                            | The message disappears and the form resets.                                                                                                                |
| Failed or rejected              | The red error message, as in Task 1.                                                                                                                       |

Clicking the button again while it is waiting does nothing, so you cannot
start two approvals for the same expense.

This applies to **Add an expense**, **Fund internal credits**, and the
**Approve in ResVault / Reject** and **Settle with credits** buttons on
obligations. **Create group** and **Add member** do not need a signature;
their buttons are simply disabled while saving.

### Example: before and after

You add "Taxi", $40.00, split equally with Sam, and click **Approve split in
ResVault**. The ResVault window opens behind Chrome.

- **Before:** nothing visible happens. Two minutes later, "ResVault did not
  respond. Install or unlock the extension." appears.
- **After:** the button greys out immediately and the waiting message tells
  you to look for the ResVault window. Once you approve, it changes to
  "Saving to the group…", then clears when the expense is saved.

### A small accessibility fix that came with it

In Split equally mode, each person's amount was marked as a "status" region,
which screen readers announce as a live update. With three members that meant
several competing status messages. The amounts are now plain text, and the
only status message is the waiting/saving line.

### Files changed

| File                                             | What it does now                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `client/src/features/groups/useGroupAction.ts`   | Tracks the stage of each action (idle, waiting for ResVault, saving) and ignores repeat clicks while one is running. |
| `client/src/features/groups/GroupsDashboard.tsx` | Each form shows the waiting/saving message and disables its button while busy.                                       |
| `client/src/features/groups/SplitEditor.tsx`     | Equal-split amounts are plain text instead of status regions.                                                        |
| `client/src/app/styles.css`                      | Style for the waiting/saving line and its small spinner.                                                             |
| `tests/e2e/groups-dashboard.spec.ts`             | New browser test for the waiting and saving stages; equal-split checks read amounts from each member's row.          |
| `tests/e2e-live/local-handoff.spec.ts`           | Reads the Member's equal share the same way.                                                                         |

### What did not change

- No server, contract, ResilientDB, or ResVault extension behavior changed.
- The two-minute limit for ResVault to answer is unchanged.

### How it was tested

- Type check, lint, and production build: pass.
- Unit tests: 26 of 26 pass.
- Browser tests (Chromium, mocked server): 6 of 6 pass. The new test holds
  ResVault's answer and the server's answer until it releases them, and checks:
  - after clicking, the waiting message appears, the button is disabled, and
    nothing has been sent to the server yet;
  - after approving in ResVault, it shows "Saving to the group…" and the button
    stays disabled while the request is sent;
  - once the server answers, the message disappears, the button is enabled
    again, no error is shown, and the form is reset.
- The real two-wallet test was updated and confirmed to load, but not run.

### How to try it yourself

1. Add an expense and click **Approve split in ResVault**.
2. Before approving, look under the button: you should see the waiting
   message and a disabled button.
3. Approve in ResVault and watch it change to "Saving to the group…".

---

## Task 4 — Expense history and obligations by name

**Status:** done, not yet committed.

### The problem in one sentence

Once you added an expense it disappeared from view, and the debts it created
read like `0xbbbbbb…bbbbbb owes 0xaaaaaa…aaaaaa`, so you could not tell what a
debt was for or who it was between.

### What changed

**1. A new Expenses panel**, between the forms and Obligations, listing every
expense in the group, newest first:

```text
HISTORY
Expenses                                              2 total

Taxi                                                   $40.00
Oct 19, 2026 · Paid by Sam
[ Sam $20.00  OWN SHARE ]  [ You $20.00 ]

Dinner                                                 $90.00
Oct 18, 2026 · Paid by you
[ You $30.00  OWN SHARE ]  [ Sam $30.00 ]  [ Priya $30.00 ]
```

- Each expense shows its description, date, total, who paid, and each
  person's share.
- **OWN SHARE** marks the payer's own part, which is not a debt.
- You appear as **You**; everyone else by display name. Hover over a name to
  see their wallet address.
- With no expenses yet: "No expenses yet. Add one above to split it with the
  group."

**2. Obligations read like sentences:**

| Before                                                   | After                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `0xbbbbbb…bbbbbb owes 0xaaaaaa…aaaaaa · original $30.00` | **Sam owes you for Dinner** / Original $30.00                    |
| `0xcccccc…cccccc owes 0xaaaaaa…aaaaaa · original $30.00` | **Priya owes you for Dinner** / Original $30.00 · $10.00 settled |
| `0xaaaaaa…aaaaaa owes 0xbbbbbb…bbbbbb · original $20.00` | **You owe Sam for Taxi** / Original $20.00                       |

- "for Dinner" comes from the expense the debt was created by.
- Once part of a debt is paid, it also shows how much has been settled.

**3. A credits hint when settling.** When you owe something but do not have
enough internal credits to pay it in full, a note appears under **Settle with
credits**, for example:

> You have $5.00 in credits. Fund $15.00 more under Fund internal credits to
> settle this in full.

It disappears once your credits cover the amount. You can still settle
part of the debt with the credits you have.

**4. Smaller wording fix.** The empty notifications message now says "No new
group notifications." instead of including your shortened wallet address.

### Who owes whom: one full example

Alex, Sam, and Priya are in a group. Alex is looking at the page.

- Alex paid $90 for dinner, split equally. → Expenses shows "Dinner, Paid by
  you", with You / Sam / Priya at $30 each. Obligations shows "Sam owes you for
  Dinner" and "Priya owes you for Dinner".
- Priya has paid back $10. → Her line shows "Original $30.00 · $10.00
  settled", and $20.00 outstanding.
- Sam paid $40 for a taxi, split with Alex. → Expenses shows "Taxi, Paid by
  Sam". Obligations shows "You owe Sam for Taxi" with a **Settle with
  credits** box, and, because Alex has only $5 in credits, the hint to fund
  $15 more.

### Files changed

| File                                                     | What it does now                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/features/groups/ExpensesPanel.tsx` (new)     | The Expenses list, newest first, with date, payer, total, and each share by name.                                                  |
| `client/src/features/groups/MemberName.tsx`              | Adds `PersonName`: shows "You"/"you" for yourself and the name-with-wallet-hover for anyone else.                                  |
| `client/src/features/groups/GroupsDashboard.tsx`         | Adds the Expenses panel; obligations show names, the expense they came from, the settled amount, and the credits hint.             |
| `client/src/app/styles.css`                              | Styles for the expense cards, share chips, obligation sentence, and credits hint.                                                  |
| `client/src/features/groups/ExpensesPanel.test.ts` (new) | Unit tests for ordering and date formatting.                                                                                       |
| `tests/e2e/groups-dashboard.spec.ts`                     | New browser test for the Expenses panel and named obligations; the main flow test also checks "You owe Alex" and the credits hint. |

### What did not change

- No server, contract, or ResilientDB behavior changed. The server already
  sent the expenses and the link from each debt to its expense; the page just
  never showed them.
- Approve / Reject / Settle work exactly as before.
- Notification messages themselves still come from the server unchanged.

### How it was tested

- Type check, lint, formatting, and production build: pass.
- Unit tests: 29 of 29 pass. The 3 new tests check that expenses are listed
  newest date first, that the most recently added one comes first when two
  share a date, and that dates display as e.g. "Oct 19, 2026" without shifting
  a day because of time zones.
- Browser tests (Chromium, mocked server): 7 of 7 pass. The new test uses the
  Alex / Sam / Priya example above and checks:
  - two expense cards, Taxi first, with the exact date, payer, total, and
    share chips (including OWN SHARE on the payer);
  - hovering Sam in the Dinner card shows his full wallet address;
  - the three obligations read "Sam owes you for Dinner", "Priya owes you for
    Dinner", and "You owe Sam for Taxi";
  - Priya's line shows "$10.00 settled", and Sam's does not;
  - the credits hint appears only on Alex's taxi debt, with the exact amounts;
  - the empty notifications message.
    The main flow test now also checks "You owe Alex", that the credits hint
    shows "Fund $60.00 more" before funding, and that it disappears after
    funding $60.

### How to try it yourself

1. Open **Friends & Groups** and select a group with a few expenses.
2. Scroll to **Expenses** to see each one with who paid and each share.
3. Under **Obligations**, check that each line names the people and the
   expense. If you owe something and have fewer credits than the amount, look
   for the hint under **Settle with credits**.

---

## Task 7 — Make Friends & Groups readable at scale

**Status:** implemented on `Anish-feature-branch`.

### The problem in one sentence

The page stacked every form, expense, and obligation in one long column, used
undefined color tokens so buttons had no accent or focus ring, and would keep
growing as a group added history.

### What you will see

The page now follows the Personal Finance layout:

1. **Hero and group switcher.** The wallet chip sits in the header. Groups
   stay in one horizontally scrolling row. **New group** hides the create
   form once you already have a group.
2. **Summary cards.** Members, Your credits, You owe, and You are owed. The
   last two are read-only sums of confirmed outstanding obligations.
3. **Update the group.** A collapsible section, open only when the group has
   no expenses yet, holds Add member, Fund credits, and Add an expense.
4. **Group activity tabs.** Obligations, Expenses, and Notifications. Each
   tab shows a count. Obligations also shows a "to do" badge when you need to
   approve or settle. The page opens on Obligations in that case, otherwise
   on Expenses.
5. **Filters and paging.** Obligations: All, Needs your action, Open,
   Settled. Expenses: All, Paid by you. Each list starts at 6 items; **Show
   more** adds 6 at a time.
6. **Focus.** Group buttons now use the same primary, secondary, and
   destructive styles as Personal Finance, with a visible focus ring on tabs,
   chips, the switcher, the accordion, and form controls.

Signing, settlement, and ResContract behavior are unchanged.

### Files changed

| File                                               | What it does now                                                |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `client/src/features/groups/activity.ts`           | Filters, counts, paging, and the You owe / You are owed totals. |
| `client/src/features/groups/GroupActivityTabs.tsx` | Tab list, filters, and Show more.                               |
| `client/src/features/groups/ObligationsList.tsx`   | Approve, reject, and settle cards.                              |
| `client/src/features/groups/GroupsDashboard.tsx`   | Hero, switcher, summary, and the Update the group accordion.    |
| `client/src/features/groups/groupActions.ts`       | Shared signing helpers moved out of the dashboard file.         |
| `client/src/app/styles.css`                        | Page tokens, spacing, tabs, chips, and focus rings.             |
| `client/src/features/groups/activity.test.ts`      | Unit tests for filters, counts, paging, and cent totals.        |
| `tests/e2e/groups-dashboard.spec.ts`               | Tabs, filters, paging, and keyboard focus.                      |
| `tests/e2e-live/local-handoff.spec.ts`             | Opens Update the group before using the funding form.           |

### How it was tested

- Type check, lint, formatting, and production build: pass.
- Unit tests: 24 of 24 group tests pass, including filters, counts, paging
  boundaries, and You owe / You are owed totals in integer cents.
- Browser tests (Chromium, mocked server): 8 of 8 pass. The new cases check
  that Obligations opens when something needs your action, filter counts,
  Show more on 14 mocked expenses, keyboard Tab reaching buttons with a
  visible outline, and light/dark screenshots at desktop and mobile widths.

### How to try it yourself

1. Open **Friends & Groups**. Pick a group from the chip row, or use
   **New group** if you need to create one.
2. Check the summary cards, then open **Update the group** if you need to add
   a member, fund credits, or add an expense.
3. Use the activity tabs and filter chips. If a list is longer than six
   items, use **Show more**. Tab to a button and confirm the focus ring.

## Task 8 — Match the dashboard header and add an in-app guide

**Status:** implemented on `main`.

### What changed

- The Friends & Groups hero now uses the same title scale, line height,
  responsive wrapping, eyebrow layout, and right-side alignment as Personal
  Finance.
- A gold help button beside **Friends & Groups** opens a keyboard-accessible
  guide using the same dialog treatment as the Personal Finance guide.
- The guide explains how to select or create a group, inspect members, add and
  split an expense, approve obligations, fund and use internal credits, review
  notifications, and understand when Personal Finance changes.
- The guide explicitly states that internal credits are non-redeemable and
  that the dashboard does not transfer fiat or cryptocurrency.

### Verification

- The browser test checks the shared desktop title scale, responsive mobile
  wrapping, help-button styling, guide content, dialog close behavior, and a
  visual screenshot of the open guide.
