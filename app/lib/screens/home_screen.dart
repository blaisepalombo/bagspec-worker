import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../push.dart';
import 'deal_detail_screen.dart';
import 'deals_screen.dart';
import 'flips_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.api, required this.onSignOut, this.push});
  final BagSpecApi api;
  final Future<void> Function() onSignOut;
  final PushBridge? push;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  StreamSubscription<OpenedNotification>? _taps;
  final _settingsKey = GlobalKey<SettingsScreenState>();

  PushBridge get _push => widget.push ?? PushBridge.instance;

  @override
  void initState() {
    super.initState();
    _taps = _push.opened.listen(_openNotification);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final launch = await _push.takeLaunchNotification();
      if (launch != null) _openNotification(launch);
    });
  }

  @override
  void dispose() {
    _taps?.cancel();
    super.dispose();
  }

  Future<void> _openNotification(OpenedNotification opened) async {
    if (!mounted) return;
    setState(() => _tab = 0);
    if (opened.dealId != null) {
      try {
        final page = await widget.api.deals();
        final deal = page.deals.where((d) => d.id == opened.dealId).firstOrNull;
        if (deal != null && mounted) {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => DealDetailScreen(deal: deal, api: widget.api)));
          return;
        }
      } catch (_) {}
    }
    final url = Uri.tryParse(opened.url ?? '');
    if (url != null && url.hasScheme) await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      DealsScreen(api: widget.api),
      FlipsScreen(api: widget.api),
      SettingsScreen(key: _settingsKey, api: widget.api, push: _push, onSignOut: widget.onSignOut),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.local_offer_outlined), selectedIcon: Icon(Icons.local_offer), label: 'Deals'),
          NavigationDestination(icon: Icon(Icons.inventory_2_outlined), selectedIcon: Icon(Icons.inventory_2), label: 'My flips'),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), selectedIcon: Icon(Icons.notifications), label: 'Alerts'),
        ],
      ),
    );
  }
}
