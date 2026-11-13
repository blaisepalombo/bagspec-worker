import 'dart:convert';

import 'package:bagspec/api.dart';
import 'package:bagspec/main.dart';
import 'package:bagspec/models.dart';
import 'package:bagspec/screens/deal_detail_screen.dart';
import 'package:bagspec/screens/deals_screen.dart';
import 'package:bagspec/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final dealJson = {
  'id': 1604529,
  'title': 'Olympus Camedia C-740 Ultra Zoom Digital Camera',
  'item_url': 'https://www.ebay.com/itm/128175992473',
  'image_url': 'https://i.ebayimg.com/images/g/x/s-l225.jpg',
  'category': 'Cameras',
  'price': 3,
  'shipping_cost': 8.53,
  'estimated_tax': 0.69,
  'total_buy_cost': 12.22,
  'estimated_profit': 17.89,
  'suggested_offer': 9.5,
  'recommendation': 'BUY',
  'deal_type': 'auction',
  'item_end_date': '2026-11-11T03:21:00.000Z',
  'inventory_id': 1,
  'first_seen_at': '2026-11-12 01:20:54',
  'reasoning': jsonEncode({'explanation': 'Lens error is usually a stuck barrel.', 'redFlags': ['No photo of the screen']}),
};

/// A fake BagSpec server: the password "right" works, anything else is 401.
MockClient fakeServer({List<http.Request>? log}) => MockClient((request) async {
      log?.add(request);
      final auth = request.headers['Authorization'];
      final ok = auth == 'Basic ${base64Encode(utf8.encode('bagspec:right'))}';
      if (!ok) return http.Response('BagSpec login required', 401);
      switch (request.url.path) {
        case '/deals':
          return http.Response(jsonEncode({'count': 1, 'nextBefore': null, 'deals': [dealJson]}), 200);
        case '/api/inventory':
          return http.Response(jsonEncode({'items': [], 'summary': {'totalProfit': 0, 'moneyTiedUp': 0, 'open': 0}}), 200);
        case '/api/devices':
          return http.Response(jsonEncode({'ok': true, 'settings': jsonDecode(request.body)['settings']}), 201);
      }
      return http.Response('{"error":"Not found"}', 404);
    });

void main() {
  FlutterSecureStorage.setMockInitialValues({});

  test('deals parse the owner notes and auction fields', () {
    final deal = Deal.fromJson(dealJson);
    expect(deal.isBuy, isTrue);
    expect(deal.isAuction, isTrue);
    expect(deal.ended, isTrue);
    expect(deal.bought, isTrue);
    expect(deal.explanation, 'Lens error is usually a stuck barrel.');
    expect(deal.redFlags, ['No photo of the screen']);
    expect(deal.firstSeenAt, DateTime.utc(2026, 11, 12, 1, 20, 54).toLocal());
    expect(money(-3.5), '-\$3.50');
  });

  test('the API sends the owner login and registers the device token', () async {
    final log = <http.Request>[];
    final api = BagSpecApi(password: 'right', client: fakeServer(log: log));
    final page = await api.deals();
    expect(page.deals.single.title, startsWith('Olympus'));
    final settings = await api.registerDevice(
        token: 'ab' * 32, sandbox: false, settings: const AlertSettings(digest: true));
    expect(settings.digest, isTrue);
    final body = jsonDecode(log.last.body) as Map<String, dynamic>;
    expect(body['environment'], 'production');
    expect(body['token'], 'ab' * 32);
  });

  test('a wrong password is reported as unauthorized', () async {
    final api = BagSpecApi(password: 'wrong', client: fakeServer());
    expect(() => api.checkLogin(), throwsA(isA<ApiException>().having((e) => e.unauthorized, 'unauthorized', isTrue)));
  });

  testWidgets('signing in with the wrong password shows an error, the right one opens Deals', (tester) async {
    await tester.pumpWidget(BagSpecApp(apiFactory: (password) => BagSpecApi(password: password, client: fakeServer())));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('password')), 'wrong');
    await tester.tap(find.byKey(const Key('sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Wrong password.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('password')), 'right');
    await tester.tap(find.byKey(const Key('sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('Deals'), findsWidgets);
    expect(find.textContaining('Olympus Camedia'), findsOneWidget);
    expect(find.text('\$17.89'), findsOneWidget);
  });

  testWidgets('deal detail shows the bid limit, notes and an eBay button', (tester) async {
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: DealDetailScreen(deal: Deal.fromJson(dealJson))));
    expect(find.text('Bid up to'), findsOneWidget);
    expect(find.text('\$9.50'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Lens error is usually a stuck barrel.'), 200);
    expect(find.text('• No photo of the screen'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Open on eBay'), 200);
    expect(find.text('Open on eBay'), findsOneWidget);
  });

  testWidgets('deal cards show WATCH vs BUY tags', (tester) async {
    final watch = Deal.fromJson({...dealJson, 'recommendation': 'WATCH', 'deal_type': 'repair', 'inventory_id': null});
    await tester.pumpWidget(MaterialApp(theme: bagSpecTheme(), home: Scaffold(body: DealCard(deal: watch))));
    expect(find.text('WATCH'), findsOneWidget);
    expect(find.text('Bought'), findsNothing);
    expect(find.text('Cameras · \$12.22 all-in'), findsOneWidget);
  });
}
