# Projektvergabe: QR-Abgabe und Testphase

- **Testphase:** `Testphase.html` per Doppelklick öffnen. Die 27 Wunschzettel enthalten fiktive Namen. Die Testphase enthält dieselben zehn Wiesbadener Challenges wie die Server-Version.
- **Echte Runde:** Mit `npm ci` die Abhängigkeiten installieren. Vor `npm start` die Umgebungsvariable `ADMIN_PASSWORD` auf ein eigenes Passwort setzen (PowerShell: `$env:ADMIN_PASSWORD = 'eigenes-passwort'`; Git Bash: `export ADMIN_PASSWORD='eigenes-passwort'`). Den **Leitung**-Link aus dem Terminal öffnen oder den Tab **Professor** wählen und mit diesem Passwort anmelden. Den gemeinsamen QR-Code zeigen. Studierende geben ihren Namen ein, ziehen die Challenges am Griff nach oben oder unten, wählen ein persönliches Bearbeitungspasswort und senden die Liste ab. Der Link prüft keine Identität und sollte nur in der Gruppe geteilt werden. In der Professorenansicht **Abgaben aktualisieren**, die Wunschprioritäten prüfen und ab zwei Abgaben **Vorschlag berechnen**; für die endgültige Verteilung alle Abgaben abwarten. Festgelegte Personen sind anderswo nicht mehr auswählbar.
- Professorenrechner und Mobilgeräte müssen sich im Netz erreichen können. Den QR-Link vor dem Einsatz mit einem Handy vor Ort testen. Bei mehreren Netzadaptern kann der erreichbare Origin über `PUBLIC_ORIGIN` gesetzt werden (z. B. `PUBLIC_ORIGIN=http://192.168.1.20:8787 npm start` in Git Bash). Die standardmäßige HTTP-Abgabe nicht ins öffentliche Internet weiterleiten.
- Studierende setzen bei der Abgabe ein Passwort (mindestens vier Zeichen). Mit dem angezeigten vierstelligen Bearbeitungscode und dem Passwort können sie dieselbe Abgabe aufrufen und ersetzen. Gleiche optionale Teamnamen signalisieren dem Vorschlag einen Wunsch, zusammen zu bleiben. Verwenden Sie für die Wunschabgabe kein Passwort, das Sie für andere Dienste verwenden.
- Die neue Runde liegt in `.project-data/round-v2.json`. Die bisherige Neun-Projekte-Runde `.project-data/round.json` wird nicht übernommen und bleibt unverändert. Für eine weitere Runde eine andere Datei über `ROUND_FILE` wählen oder die bisherige bei gestopptem Server archivieren. Die Rundendateien enthalten private Daten und sollen nicht freigegeben werden.
- Pro Challenge ist Team A und optional Team B möglich. Es gibt keine Mindestgröße; je Gruppe gilt weiterhin die Obergrenze von drei oder vier Personen, die der Professor auch niedriger einstellen kann. **Confirm** bestätigt eine Person, **Undo** hebt die Zusortierung auf. **Alle Vorschläge bestätigen** übernimmt alle aktuell vorgeschlagenen, noch nicht bestätigten Zusortierungen. **Endgültige Zusortierung** zeigt den bestätigten Stand, auch bei einer Teilrunde, mit CSV- und PDF-Download (in der Offline-Testphase über den Druckdialog als PDF speichern).
- In der angemeldeten Professorenansicht unter **Wunschzettel verwalten** lassen sich einzelne Live-Abgaben löschen. Prüfen Sie vor der Bestätigung Name, Team (falls angegeben) und Kennung. Beim Löschen wird eine bestätigte Zuteilung dieser Person aufgehoben und der bisherige Vorschlag verworfen. Andere bestätigte Zuteilungen bleiben erhalten. Bei Bedarf anschließend einen neuen Vorschlag berechnen. Bereits heruntergeladene Listen und archivierte Runden ändern sich nicht.
- `npm test` führt die Tests aus, `node seminar/build-demo.js` erzeugt `Testphase.html` und `node seminar/browser-check.js --live` prüft den Browserablauf mit separaten Testdaten.

## Archiv: frühere Dateivariante ohne QR-Abgabe

`Projektvergabe.html` per Doppelklick im Browser öffnen. Die Datei enthält die gesamte Anwendung und braucht keinen Server.

## Eine Runde durchführen

1. Der Professor vergibt die Kennungen **01–27** und verteilt dieselbe HTML-Datei. Die Zuordnung von Kennungen zu Namen bleibt außerhalb der App.
2. Studierende öffnen den Reiter **Studierende**, sortieren die neun Projekte, laden den Wunschzettel als JSON herunter und reichen ihn über den vereinbarten Kanal ein.
3. Der Professor beginnt in seinem Browser eine **leere Runde** und importiert die 27 erhaltenen Dateien. Der Import kann in mehreren Schritten erfolgen.
4. **Vorschlag berechnen**. Bei mindestens sechs Erstwünschen kann der Professor eine zweite Gruppe freigeben und die Wunschverteilung mit der Lösung ohne Zusatzplätze vergleichen, solange die bereits festgelegten Plätze diese Lösung noch zulassen.
5. Die vorgeschlagenen Personen einzeln **festlegen** oder manuell aus der Auswahl übernehmen. Festgelegte Personen erscheinen nicht mehr in anderen Auswahllisten; **Freigeben** macht die Festlegung rückgängig. Ist alles festgelegt, lässt sich die endgültige Zuteilung als CSV herunterladen.

## Startregeln

- Pro Projekt mindestens zwei Personen; regulär höchstens drei. Bei freigegebener zweiter Gruppe höchstens sechs. Ab vier Zuteilungen werden die Personen nach Kennungsreihenfolge auf zwei möglichst gleich große Gruppen aufgeteilt (A/B).
- Die Berechnung minimiert zuerst die Anzahl der 9. Wünsche, dann die der 8. Wünsche usw. Bereits festgelegte Plätze bleiben unverändert. Eine feste Losnummer ermöglicht reproduzierbare Gleichstandsentscheidungen ohne Einfluss der Importreihenfolge. Die Regel maximiert nicht zwingend die Anzahl der Erstwünsche.
- Das ist eine lokale Dateianwendung: Die Reiter sind **keine Anmeldung oder Zugriffskontrolle**. Wunschzettel werden nicht automatisch übermittelt; die Professorenrunde liegt im lokalen Browserspeicher. Verwenden Sie für die Runde dieselbe HTML-Datei und dasselbe Browserprofil. Die Original-Wunschzettel, die Losnummer und den endgültigen Export getrennt aufbewahren.

## Entwicklung

`node build.js` erzeugt aus den Quelldateien die eigenständige HTML-Datei. `node --test` führt die Tests aus.
