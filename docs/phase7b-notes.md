# Phase 7b notes: whole-portfolio projection

- Route `#/projections/all`. Reached from the "Whole portfolio" card on `#/projections`, a "Look ahead" link on the Home statement card, and search (Ctrl+K). No new tab: the three-tab bar stays as it is.
- It is the single-investment projection (`js/models/projections.js`) run for every open investment and added up (`js/models/portfolio-projection.js`). There is no second set of growth rules.
- Scenario A with no rate typed means each investment at its own saved rate. An investment with no usable saved rate is held flat at its worth today and named on the screen. A typed rate applies to every open investment. Scenario B is always one typed rate for all.
- Shared investments count at their FULL value, exactly like Home, so totals match between screens. A "my share only" view is not built.
- Closed investments are not included (the screen says how many). An investment that cannot be calculated is left out and named.
- Regular payments (rent and costs) from every investment are added in, from tomorrow on, and can be switched off. Payments already due and not recorded are never counted.
- The portfolio yearly return is an XIRR over the total worth today, every expected payment, and the total worth at the end.
- Nothing is saved. Every row is marked as a projection.

## Not built
- Editing the rate of one investment inside the portfolio screen (type one rate for all, or change the saved rate on the investment).
- A "my share only" option for shared investments.
