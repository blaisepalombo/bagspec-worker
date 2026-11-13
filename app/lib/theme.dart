import 'package:flutter/material.dart';

/// Colors match the bagspec.com dashboard: near-black surfaces, green for
/// BUY and profit, amber for WATCH.
class BagSpecColors {
  static const background = Color(0xFF0E0F0F);
  static const surface = Color(0xFF17191A);
  static const line = Color(0xFF2A2D2F);
  static const text = Color(0xFFE8EAEB);
  static const muted = Color(0xFF9AA1A6);
  static const green = Color(0xFF4CAF7A);
  static const amber = Color(0xFFE0A23B);
  static const red = Color(0xFFE06A5F);
}

ThemeData bagSpecTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: BagSpecColors.green,
    brightness: Brightness.dark,
    surface: BagSpecColors.surface,
  ).copyWith(primary: BagSpecColors.green);
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: BagSpecColors.background,
    useMaterial3: true,
    appBarTheme: const AppBarTheme(
      backgroundColor: BagSpecColors.background,
      foregroundColor: BagSpecColors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: BagSpecColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: BagSpecColors.line),
      ),
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: BagSpecColors.surface,
      indicatorColor: Color(0x334CAF7A),
    ),
    dividerColor: BagSpecColors.line,
  );
}
